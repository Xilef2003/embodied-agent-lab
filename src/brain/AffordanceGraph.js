export class AffordanceGraph {
    constructor() {
        this.affordances = new Map();
        this.events = [];
    }

    addAffordance(concept, affordance, confidence = 1, reason = "manual") {
        const key = this._normalize(concept);

        if (!this.affordances.has(key)) {
            this.affordances.set(key, new Map());
        }

        const existing = this.affordances.get(key).get(affordance);

        const record = {
            concept: key,
            affordance,
            confidence: this._clamp(confidence),
            reason,
            createdAt: existing?.createdAt || Date.now(),
            updatedAt: Date.now()
        };

        this.affordances.get(key).set(affordance, record);

        this._recordEvent({
            type: existing ? "set_affordance" : "add_affordance",
            concept: key,
            affordance,
            confidence: record.confidence,
            reason
        });

        return record;
    }

    reinforceAffordance(concept, affordance, amount = 0.06, reason = "experience") {
        return this._updateAffordance(concept, affordance, Math.abs(amount), reason, "reinforce");
    }

    weakenAffordance(concept, affordance, amount = 0.04, reason = "experience") {
        return this._updateAffordance(concept, affordance, -Math.abs(amount), reason, "weaken");
    }

    getAffordances(concept) {
        const key = this._normalize(concept);
        const map = this.affordances.get(key);

        if (!map) return [];

        return [...map.values()]
            .sort((a, b) => b.confidence - a.confidence);
    }

    hasAffordance(concept, affordance, minConfidence = 0.5) {
        const key = this._normalize(concept);
        const record = this.affordances.get(key)?.get(affordance);

        return Boolean(record && record.confidence >= minConfidence);
    }

    getConfidence(concept, affordance) {
        const key = this._normalize(concept);
        return this.affordances.get(key)?.get(affordance)?.confidence ?? 0;
    }

    getRecentEvents(limit = 8) {
        return this.events.slice(-limit);
    }

    explain(concept) {
        const key = this._normalize(concept);

        return {
            concept: key,
            affordances: this.getAffordances(key)
        };
    }

    toJSON() {
        const result = [];

        for (const records of this.affordances.values()) {
            for (const record of records.values()) {
                result.push({ ...record });
            }
        }

        return result;
    }

    _updateAffordance(concept, affordance, delta, reason, eventType) {
        const key = this._normalize(concept);

        if (!this.affordances.has(key)) {
            this.affordances.set(key, new Map());
        }

        const existing = this.affordances.get(key).get(affordance);

        const oldConfidence = existing?.confidence ?? 0.35;
        const newConfidence = this._clamp(oldConfidence + delta);

        const record = {
            concept: key,
            affordance,
            confidence: newConfidence,
            reason,
            createdAt: existing?.createdAt || Date.now(),
            updatedAt: Date.now()
        };

        this.affordances.get(key).set(affordance, record);

        this._recordEvent({
            type: eventType,
            concept: key,
            affordance,
            oldConfidence,
            newConfidence,
            delta,
            reason
        });

        return record;
    }

    _recordEvent(event) {
        this.events.push({
            ...event,
            time: Date.now()
        });

        if (this.events.length > 120) {
            this.events.shift();
        }
    }

    _clamp(value) {
        return Math.max(0, Math.min(1, value));
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