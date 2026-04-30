export class ExperienceSummary {
    constructor(options = {}) {
        this.config = {
            maxRecentEvents: 80,
            maxProfiles: 8,
            ...options
        };

        this.concepts = new Map();
        this.recentEvents = [];
        this.totalEvents = 0;
    }

    ingestEvents(events = [], semanticMemory = null) {
        const summaryEvents = [];

        for (const event of events) {
            if (!event || !event.concept) continue;

            const concept = this._normalize(event.concept);
            const profile = this._ensureProfile(concept);

            this.totalEvents++;
            profile.totalEvents++;
            profile.lastEventKind = event.kind;
            profile.lastMessage = event.message || "";
            profile.lastUpdatedAt = Date.now();

            switch (event.kind) {
                case "pickup_success":
                    profile.pickupSuccess++;
                    profile.pickupAttempts++;
                    profile.positiveEvidence++;
                    profile.tags.add("collectable");
                    profile.tags.add("graspable");
                    break;

                case "pickup_failure":
                    profile.pickupFailure++;
                    profile.pickupAttempts++;
                    profile.negativeEvidence++;
                    profile.tags.add("difficult_to_grasp");
                    break;

                case "blocked_movement":
                    profile.blockedMovement++;
                    profile.positiveEvidence++;
                    profile.tags.add("blocks_path");
                    break;

                case "safety_learning":
                    profile.safetyEvents++;
                    profile.positiveEvidence++;
                    profile.tags.add("keep_distance");
                    profile.tags.add("risk_relevant");
                    break;

                case "charge_success":
                    profile.chargeSuccess++;
                    profile.positiveEvidence++;
                    profile.tags.add("energy_source");
                    break;

                case "empty_success":
                    profile.emptySuccess++;
                    profile.positiveEvidence++;
                    profile.tags.add("base_utility");
                    break;

                case "relation_learned":
                    profile.relationsLearned++;
                    profile.positiveEvidence++;
                    profile.tags.add("new_relation");
                    break;

                default:
                    profile.otherEvents++;
                    break;
            }

            if (semanticMemory) {
                profile.affordanceSnapshot = this._readAffordanceSnapshot(concept, semanticMemory);
            }

            profile.pickupSuccessRate = this._safeRate(
                profile.pickupSuccess,
                profile.pickupAttempts
            );

            profile.reliability = this._computeReliability(profile);
            profile.summary = this._makeProfileSummary(profile);

            const summaryEvent = {
                concept,
                kind: event.kind,
                message: profile.summary,
                time: Date.now()
            };

            this._recordRecent(summaryEvent);
            summaryEvents.push(summaryEvent);
        }

        return summaryEvents;
    }

    getProfile(concept) {
        const key = this._normalize(concept);
        const profile = this.concepts.get(key);
        if (!profile) return null;

        return this._publicProfile(profile);
    }

    getTopProfiles(limit = this.config.maxProfiles) {
        return [...this.concepts.values()]
            .sort((a, b) => {
                const scoreA = this._profileImportance(a);
                const scoreB = this._profileImportance(b);
                return scoreB - scoreA;
            })
            .slice(0, limit)
            .map(profile => this._publicProfile(profile));
    }

    getState(semanticMemory = null) {
        if (semanticMemory) {
            for (const profile of this.concepts.values()) {
                profile.affordanceSnapshot = this._readAffordanceSnapshot(
                    profile.concept,
                    semanticMemory
                );
                profile.summary = this._makeProfileSummary(profile);
            }
        }

        return {
            totalEvents: this.totalEvents,
            conceptCount: this.concepts.size,
            profiles: this.getTopProfiles(),
            recentEvents: this.recentEvents.slice(-10)
        };
    }

    _ensureProfile(concept) {
        const key = this._normalize(concept);

        if (!this.concepts.has(key)) {
            this.concepts.set(key, {
                concept: key,
                totalEvents: 0,

                pickupAttempts: 0,
                pickupSuccess: 0,
                pickupFailure: 0,
                pickupSuccessRate: null,

                blockedMovement: 0,
                safetyEvents: 0,
                chargeSuccess: 0,
                emptySuccess: 0,
                relationsLearned: 0,
                otherEvents: 0,

                positiveEvidence: 0,
                negativeEvidence: 0,
                reliability: 0,

                tags: new Set(),
                affordanceSnapshot: {},

                lastEventKind: null,
                lastMessage: "",
                lastUpdatedAt: null,
                summary: ""
            });
        }

        return this.concepts.get(key);
    }

    _publicProfile(profile) {
        return {
            concept: profile.concept,
            totalEvents: profile.totalEvents,

            pickupAttempts: profile.pickupAttempts,
            pickupSuccess: profile.pickupSuccess,
            pickupFailure: profile.pickupFailure,
            pickupSuccessRate: profile.pickupSuccessRate,

            blockedMovement: profile.blockedMovement,
            safetyEvents: profile.safetyEvents,
            chargeSuccess: profile.chargeSuccess,
            emptySuccess: profile.emptySuccess,
            relationsLearned: profile.relationsLearned,

            positiveEvidence: profile.positiveEvidence,
            negativeEvidence: profile.negativeEvidence,
            reliability: profile.reliability,

            tags: [...profile.tags],
            affordanceSnapshot: { ...profile.affordanceSnapshot },

            lastEventKind: profile.lastEventKind,
            lastMessage: profile.lastMessage,
            summary: profile.summary
        };
    }

    _profileImportance(profile) {
        return (
            profile.totalEvents * 1.0 +
            profile.pickupSuccess * 2.0 +
            profile.pickupFailure * 1.5 +
            profile.blockedMovement * 1.4 +
            profile.safetyEvents * 1.8 +
            profile.chargeSuccess * 0.5 +
            profile.emptySuccess * 0.8
        );
    }

    _computeReliability(profile) {
        const evidence = profile.positiveEvidence + profile.negativeEvidence;

        if (evidence === 0) return 0;

        const base = profile.positiveEvidence / evidence;
        const evidenceBoost = Math.min(0.25, evidence * 0.03);

        return Math.max(0, Math.min(1, base * 0.85 + evidenceBoost));
    }

    _makeProfileSummary(profile) {
        const parts = [];

        if (profile.pickupAttempts > 0) {
            const rate = Math.round((profile.pickupSuccessRate || 0) * 100);
            parts.push(
                `${profile.concept}: ${profile.pickupSuccess}/${profile.pickupAttempts} Pickups erfolgreich (${rate}%)`
            );
        } else {
            parts.push(`${profile.concept}: ${profile.totalEvents} Ereignisse`);
        }

        if (profile.blockedMovement > 0) {
            parts.push(`${profile.blockedMovement}x Weg blockiert`);
        }

        if (profile.safetyEvents > 0) {
            parts.push(`${profile.safetyEvents}x Sicherheitsrelevanz`);
        }

        if (profile.chargeSuccess > 0) {
            parts.push(`${profile.chargeSuccess}x erfolgreich geladen`);
        }

        if (profile.emptySuccess > 0) {
            parts.push(`${profile.emptySuccess}x erfolgreich entladen`);
        }

        const confidenceParts = [];

        for (const [affordance, confidence] of Object.entries(profile.affordanceSnapshot || {})) {
            if (confidence > 0) {
                confidenceParts.push(`${affordance}: ${Math.round(confidence * 100)}%`);
            }
        }

        if (confidenceParts.length > 0) {
            parts.push(confidenceParts.slice(0, 3).join(", "));
        }

        return parts.join(" | ");
    }

    _readAffordanceSnapshot(concept, semanticMemory) {
        const explanation = semanticMemory.explainConcept(concept);
        const snapshot = {};

        for (const item of explanation.affordances || []) {
            snapshot[item.affordance] = item.confidence;
        }

        return snapshot;
    }

    _recordRecent(event) {
        this.recentEvents.push(event);

        if (this.recentEvents.length > this.config.maxRecentEvents) {
            this.recentEvents.shift();
        }
    }

    _safeRate(success, attempts) {
        if (!attempts) return null;
        return success / attempts;
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