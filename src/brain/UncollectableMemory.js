export class UncollectableMemory {
    constructor(options = {}) {
        this.config = {
            maxItems: 80,
            maxRecentEvents: 80,
            ...options
        };

        this.items = new Map();
        this.concepts = new Map();
        this.recentEvents = [];
    }

    ingestUtilityTargets(targets = [], step = 0) {
        for (const target of targets) {
            if (!target?.utility?.physical) continue;

            const physical = target.utility.physical;

            if (!physical.hardImpossible && physical.penalty < 0.6) {
                continue;
            }

            this._recordItem({
                entityId: target.id || target.entity?.id,
                concept: target.concept,
                label: target.label,
                kind: physical.hardImpossible ? "uncollectable" : "physically_difficult",
                step,
                reasons: physical.reasons || [],
                weightKg: physical.weightKg,
                sizeUnits: physical.sizeUnits,
                severity: physical.hardImpossible ? 1 : physical.penalty,
                source: "utility"
            });
        }
    }

    ingestPickupFailure(result, step = 0, semanticMemory = null) {
        if (!result || result.ok || !result.target) return;

        const target = result.target;
        const concept = semanticMemory
            ? semanticMemory.entityToConcept(target)
            : this._normalize(target.label || target.props?.label || target.type || "unknown");

        const label = target.label || target.props?.label || concept;
        const failureReason = result.failureReason || "pickup_failed";

        const reasons = [];

        if (failureReason === "too_heavy") {
            reasons.push(result.message || "Objekt war zu schwer.");
        }

        if (failureReason === "too_large") {
            reasons.push(result.message || "Objekt war zu groß.");
        }

        if (failureReason === "grip_failed") {
            reasons.push(result.message || "Objekt ist beim Greifen entglitten.");
        }

        const kind =
            failureReason === "too_heavy" || failureReason === "too_large"
                ? "uncollectable"
                : "physically_difficult";

        this._recordItem({
            entityId: target.id,
            concept,
            label,
            kind,
            step,
            reasons,
            weightKg: target.props?.weightKg,
            sizeUnits: target.props?.sizeUnits,
            failureReason,
            severity: kind === "uncollectable" ? 1 : 0.55,
            source: "pickup_failure"
        });
    }

    ingestPickupSuccess(result, step = 0, semanticMemory = null) {
        if (!result?.ok || !result.target) return;

        const target = result.target;
        const entityId = target.id;

        if (!this.items.has(entityId)) return;

        const item = this.items.get(entityId);

        if (item.resolved) return;

        item.resolved = true;
        item.lastStep = step;
        item.status = "resolved";
        item.reasons.add("Später erfolgreich gesammelt.");

        this._recordRecent({
            kind: "resolved",
            concept: item.concept,
            label: item.label,
            message: `${item.label} wurde trotz früherer Schwierigkeit erfolgreich gesammelt.`
        });

        if (semanticMemory) {
            const concept = semanticMemory.entityToConcept(target);
            const conceptProfile = this._ensureConcept(concept);
            conceptProfile.resolvedCount++;
            conceptProfile.score = this._computeConceptScore(conceptProfile);
        }
    }

    getState(currentStep = 0) {
        const allActiveItems = [...this.items.values()]
            .filter(item => !item.resolved);

        const activeItems = allActiveItems
            .sort((a, b) => {
                const scoreA = this._importance(a, currentStep);
                const scoreB = this._importance(b, currentStep);
                return scoreB - scoreA;
            })
            .slice(0, this.config.maxItems)
            .map(item => this._publicItem(item, currentStep));

        const conceptProfiles = [...this.concepts.values()]
            .sort((a, b) => b.score - a.score)
            .map(profile => ({
                concept: profile.concept,
                uncollectableCount: profile.uncollectableCount,
                difficultCount: profile.difficultCount,
                resolvedCount: profile.resolvedCount,
                failureReasons: [...profile.failureReasons],
                score: profile.score,
                scorePercent: Math.round(profile.score * 100),
                summary: this._conceptSummary(profile)
            }));

        return {
            count: allActiveItems.length,
            items: activeItems.slice(0, 8),
            conceptProfiles: conceptProfiles.slice(0, 8),
            recentEvents: this.recentEvents.slice(-8)
        };
    }

    _recordItem(data) {
        if (!data.entityId) return;

        const key = data.entityId;
        const concept = this._normalize(data.concept || "unknown");
        const label = data.label || concept;

        const isNewItem = !this.items.has(key);

        if (isNewItem) {
            this.items.set(key, {
                entityId: key,
                concept,
                label,
                status: data.kind,
                firstStep: data.step,
                lastStep: data.step,
                observations: 0,
                failureCount: 0,
                reasons: new Set(),
                failureReasons: new Set(),
                weightKg: data.weightKg,
                sizeUnits: data.sizeUnits,
                severity: 0,
                resolved: false,
                sources: new Set()
            });
        }

        const item = this.items.get(key);

        const previousStatus = item.status;
        const previousReasonCount = item.reasons.size;
        const previousFailureReasonCount = item.failureReasons.size;

        item.concept = concept;
        item.label = label;
        item.lastStep = data.step;
        item.observations++;
        item.severity = Math.max(item.severity, data.severity || 0);
        item.weightKg = data.weightKg ?? item.weightKg;
        item.sizeUnits = data.sizeUnits ?? item.sizeUnits;
        item.sources.add(data.source || "unknown");

        if (data.kind === "uncollectable") {
            item.status = "uncollectable";
        } else if (item.status !== "uncollectable") {
            item.status = data.kind || "physically_difficult";
        }

        for (const reason of data.reasons || []) {
            if (reason) item.reasons.add(reason);
        }

        if (data.failureReason) {
            item.failureCount++;
            item.failureReasons.add(data.failureReason);
        }

        const becameUncollectable =
            previousStatus !== "uncollectable" &&
            item.status === "uncollectable";

        const gotNewReason =
            item.reasons.size > previousReasonCount ||
            item.failureReasons.size > previousFailureReasonCount;

        this._updateConceptProfile(concept, item, {
            isNewItem,
            becameUncollectable
        });

        if (isNewItem || becameUncollectable || gotNewReason || data.source === "pickup_failure") {
            this._recordRecent({
                kind: item.status,
                concept,
                label,
                message: `${label} als ${item.status === "uncollectable" ? "nicht sammelbar" : "schwierig"} markiert.`
            });
        }
    }

    _updateConceptProfile(concept, item, flags = {}) {
        const profile = this._ensureConcept(concept);

        if (flags.isNewItem) {
            if (item.status === "uncollectable") {
                profile.uncollectableCount++;
            } else {
                profile.difficultCount++;
            }
        } else if (flags.becameUncollectable) {
            profile.uncollectableCount++;
            profile.difficultCount = Math.max(0, profile.difficultCount - 1);
        }

        for (const reason of item.failureReasons) {
            profile.failureReasons.add(reason);
        }

        profile.score = this._computeConceptScore(profile);
    }

    _computeConceptScore(profile) {
        return Math.min(
            1,
            profile.uncollectableCount * 0.25 +
            profile.difficultCount * 0.12 +
            profile.failureReasons.size * 0.08
        );
    }

    _ensureConcept(concept) {
        const key = this._normalize(concept);

        if (!this.concepts.has(key)) {
            this.concepts.set(key, {
                concept: key,
                uncollectableCount: 0,
                difficultCount: 0,
                resolvedCount: 0,
                failureReasons: new Set(),
                score: 0
            });
        }

        return this.concepts.get(key);
    }

    _publicItem(item, currentStep) {
        return {
            entityId: item.entityId,
            concept: item.concept,
            label: item.label,
            status: item.status,
            observations: item.observations,
            failureCount: item.failureCount,
            reasons: [...item.reasons],
            failureReasons: [...item.failureReasons],
            weightKg: item.weightKg,
            sizeUnits: item.sizeUnits,
            severity: item.severity,
            severityPercent: Math.round(item.severity * 100),
            firstStep: item.firstStep,
            lastStep: item.lastStep,
            stepsSinceSeen: Math.max(0, currentStep - item.lastStep),
            sources: [...item.sources],
            summary: this._itemSummary(item)
        };
    }

    _itemSummary(item) {
        const parts = [];

        parts.push(`${item.label} (${item.concept})`);

        if (item.weightKg !== undefined) {
            parts.push(`${item.weightKg}kg`);
        }

        if (item.sizeUnits !== undefined) {
            parts.push(`Größe ${item.sizeUnits}`);
        }

        if (item.failureReasons.size > 0) {
            parts.push([...item.failureReasons].join(", "));
        }

        if (item.reasons.size > 0) {
            parts.push([...item.reasons].slice(0, 2).join("; "));
        }

        return parts.join(" · ");
    }

    _conceptSummary(profile) {
        const parts = [];

        parts.push(profile.concept);

        if (profile.uncollectableCount > 0) {
            parts.push(`${profile.uncollectableCount}x nicht sammelbar`);
        }

        if (profile.difficultCount > 0) {
            parts.push(`${profile.difficultCount}x schwierig`);
        }

        if (profile.resolvedCount > 0) {
            parts.push(`${profile.resolvedCount}x später geschafft`);
        }

        if (profile.failureReasons.size > 0) {
            parts.push([...profile.failureReasons].join(", "));
        }

        return parts.join(" · ");
    }

    _importance(item, currentStep) {
        const recency = 1 / (1 + Math.max(0, currentStep - item.lastStep) / 80);

        return (
            item.severity * 2 +
            item.failureCount * 0.5 +
            item.observations * 0.05 +
            recency
        );
    }

    _recordRecent(event) {
        this.recentEvents.push({
            ...event,
            time: Date.now()
        });

        if (this.recentEvents.length > this.config.maxRecentEvents) {
            this.recentEvents.shift();
        }
    }

    _normalize(value) {
        return String(value)
            .toLowerCase()
            .normalize("NFKC")
            .replace(/ä/g, "a")
            .replace(/ö/g, "o")
            .replace(/ü/g, "u")
            .replace(/ß/g, "ss")
            .replace(/[^a-z0-9_-]+/g, "_")
            .replace(/^_+|_+$/g, "");
    }
}