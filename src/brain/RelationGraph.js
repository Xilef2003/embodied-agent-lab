export class RelationGraph {
    constructor() {
        this.edges = [];
        this.bySubject = new Map();
        this.byObject = new Map();
    }

    addRelation(subject, relation, object, confidence = 1, source = "manual", context = "global") {
        const edge = {
            subject: this._normalize(subject),
            relation,
            object: this._normalize(object),
            confidence,
            source,
            context,
            createdAt: Date.now()
        };

        this.edges.push(edge);

        if (!this.bySubject.has(edge.subject)) {
            this.bySubject.set(edge.subject, []);
        }

        if (!this.byObject.has(edge.object)) {
            this.byObject.set(edge.object, []);
        }

        this.bySubject.get(edge.subject).push(edge);
        this.byObject.get(edge.object).push(edge);

        return edge;
    }

    getRelationsFor(subject, relation = null) {
        const key = this._normalize(subject);
        const edges = this.bySubject.get(key) || [];

        if (!relation) return [...edges];

        return edges.filter(edge => edge.relation === relation);
    }

    getIncomingRelations(object, relation = null) {
        const key = this._normalize(object);
        const edges = this.byObject.get(key) || [];

        if (!relation) return [...edges];

        return edges.filter(edge => edge.relation === relation);
    }

    getObjects(subject, relation) {
        return this.getRelationsFor(subject, relation).map(edge => edge.object);
    }

    getSubjects(relation, object) {
        return this.getIncomingRelations(object, relation).map(edge => edge.subject);
    }

    hasRelation(subject, relation, object) {
        const normalizedObject = this._normalize(object);

        return this.getRelationsFor(subject, relation)
            .some(edge => edge.object === normalizedObject);
    }

    getAncestors(concept, relation = "is_a", maxDepth = 6) {
        const start = this._normalize(concept);
        const visited = new Set();
        const result = [];

        const walk = (node, depth) => {
            if (depth > maxDepth) return;
            if (visited.has(node)) return;

            visited.add(node);

            const parents = this.getObjects(node, relation);

            for (const parent of parents) {
                result.push(parent);
                walk(parent, depth + 1);
            }
        };

        walk(start, 0);

        return [...new Set(result)];
    }

    explain(concept) {
        const key = this._normalize(concept);

        return {
            concept: key,
            outgoing: this.getRelationsFor(key),
            incoming: this.getIncomingRelations(key),
            ancestors: this.getAncestors(key)
        };
    }

    toJSON() {
        return this.edges.map(edge => ({ ...edge }));
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