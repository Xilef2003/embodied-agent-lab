export class AffordanceGraph {
    constructor() {
        this.affordances = new Map();
    }

    addAffordance(concept, affordance, confidence = 1, reason = "manual") {
        const key = this._normalize(concept);

        if (!this.affordances.has(key)) {
            this.affordances.set(key, new Map());
        }

        const record = {
            concept: key,
            affordance,
            confidence,
            reason,
            createdAt: Date.now()
        };

        this.affordances.get(key).set(affordance, record);

        return record;
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