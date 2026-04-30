import { ENTITY } from "../config.js";
import { manhattan } from "../utils/Grid.js";
import { RelationGraph } from "./RelationGraph.js";
import { AffordanceGraph } from "./AffordanceGraph.js";

export class SemanticMemory {
    constructor() {
        this.relations = new RelationGraph();
        this.affordances = new AffordanceGraph();

        this._seedBaseKnowledge();
    }

    evaluateEntity(entity, robotPosition = null) {
        const concept = this.entityToConcept(entity);
        const ancestors = this.relations.getAncestors(concept);

        const allConcepts = [concept, ...ancestors];

        const affordances = this._collectInheritedAffordances(allConcepts);

        const collectable = affordances.some(item => item.affordance === "collect");
        const chargeable = affordances.some(item => item.affordance === "charge");
        const shouldAvoid = affordances.some(item =>
            item.affordance === "avoid" ||
            item.affordance === "keep_distance"
        );

        const graspable = affordances.some(item => item.affordance === "grasp");
        const obstacleLike = affordances.some(item => item.affordance === "blocks_path");

        return {
            id: entity.id,
            entity,
            concept,
            label: entity.label || concept,
            type: entity.type,
            ancestors,
            affordances,
            collectable,
            chargeable,
            shouldAvoid,
            graspable,
            obstacleLike,
            distance: robotPosition ? manhattan(robotPosition, entity) : entity.distance ?? Infinity,
            explanation: this.explainConcept(concept)
        };
    }

    evaluateWorld(worldModel, robot) {
        const robotPosition = robot.position;

        const knownEntities = [...worldModel.knownEntities.values()]
            .map(entity => this.evaluateEntity(entity, robotPosition));

        const collectableTargets = knownEntities
            .filter(item => item.collectable)
            .filter(item => !item.shouldAvoid)
            .sort((a, b) => a.distance - b.distance);

        const hazards = knownEntities
            .filter(item => item.shouldAvoid)
            .sort((a, b) => a.distance - b.distance);

        const chargingTargets = knownEntities
            .filter(item => item.chargeable)
            .sort((a, b) => a.distance - b.distance);

        return {
            knownEntities,
            collectableTargets,
            hazards,
            chargingTargets,
            relationCount: this.relations.edges.length,
            affordanceCount: this.affordances.toJSON().length,
            recentSemanticEvents: this.affordances.getRecentEvents(8)
        };
    }

    evaluateObservation(observation, worldModel, robot) {
        const worldSemantic = this.evaluateWorld(worldModel, robot);

        const visibleEntities = observation.visibleEntities
            .map(entity => this.evaluateEntity(entity, robot.position));

        return {
            ...worldSemantic,
            visibleEntities,
            visibleConcepts: [...new Set(visibleEntities.map(item => item.concept))]
        };
    }

    addRelation(subject, relation, object, confidence = 1, source = "manual", context = "global") {
        if (this.hasRelation(subject, relation, object)) {
            return null;
        }

        return this.relations.addRelation(
            subject,
            relation,
            object,
            confidence,
            source,
            context
        );
    }

    hasRelation(subject, relation, object) {
        return this.relations.hasRelation(subject, relation, object);
    }

    reinforceAffordance(concept, affordance, amount = 0.06, reason = "experience") {
        return this.affordances.reinforceAffordance(concept, affordance, amount, reason);
    }

    weakenAffordance(concept, affordance, amount = 0.04, reason = "experience") {
        return this.affordances.weakenAffordance(concept, affordance, amount, reason);
    }

    explainConcept(concept) {
        const normalized = this._normalize(concept);

        return {
            concept: normalized,
            relations: this.relations.explain(normalized),
            affordances: this._collectInheritedAffordances([
                normalized,
                ...this.relations.getAncestors(normalized)
            ])
        };
    }

    entityToConcept(entity) {
        const label = this._normalize(entity.label || "");

        if (label) {
            const directMap = {
                plastikflasche: "plastikflasche",
                flasche: "plastikflasche",

                dose: "dose",
                dosen: "dose",

                papier: "papier",

                // Wichtig:
                // "Tüte" wird durch _normalize() zu "tute".
                // Deshalb müssen sowohl "tute" als auch "tuete" auf dasselbe Konzept zeigen.
                tute: "tuete",
                tuete: "tuete",
                beutel: "tuete",

                verpackung: "verpackung",
                verpackungen: "verpackung",

                ladestation: "ladestation",
                basis: "ladestation",

                stein: "stein",
                steine: "stein",

                baum: "baum",
                baeume: "baum",
                baume: "baum",

                mensch: "mensch",
                menschen: "mensch",

                tier: "tier",
                tiere: "tier",

                muell: "muell",
                mull: "muell"
            };

            if (directMap[label]) {
                return directMap[label];
            }
        }

        const typeMap = {
            [ENTITY.TRASH]: "muell",
            [ENTITY.OBSTACLE]: "hindernis",
            [ENTITY.CHARGER]: "ladestation",
            [ENTITY.HUMAN]: "mensch",
            [ENTITY.ANIMAL]: "tier"
        };

        return typeMap[entity.type] || this._normalize(entity.type || "unbekannt");
    }

    _collectInheritedAffordances(concepts) {
        const merged = new Map();

        for (const concept of concepts) {
            const affordances = this.affordances.getAffordances(concept);

            for (const item of affordances) {
                const existing = merged.get(item.affordance);

                if (!existing || item.confidence > existing.confidence) {
                    merged.set(item.affordance, {
                        ...item,
                        inheritedFrom: item.concept
                    });
                }
            }
        }

        return [...merged.values()]
            .sort((a, b) => b.confidence - a.confidence);
    }

    _seedBaseKnowledge() {
        // Taxonomie
        this.relations.addRelation("plastikflasche", "is_a", "muell", 0.98, "seed");
        this.relations.addRelation("dose", "is_a", "muell", 0.98, "seed");
        this.relations.addRelation("papier", "is_a", "muell", 0.92, "seed");
        this.relations.addRelation("tuete", "is_a", "muell", 0.96, "seed");
        this.relations.addRelation("verpackung", "is_a", "muell", 0.95, "seed");

        this.relations.addRelation("stein", "is_a", "natur_objekt", 0.95, "seed");
        this.relations.addRelation("baum", "is_a", "natur_objekt", 0.95, "seed");

        this.relations.addRelation("mensch", "is_a", "lebewesen", 1, "seed");
        this.relations.addRelation("tier", "is_a", "lebewesen", 1, "seed");

        this.relations.addRelation("ladestation", "is_a", "energiequelle", 1, "seed");

        // Zweck- und Bedeutungsrelationen
        this.relations.addRelation("muell", "belongs_in", "sammelbehaelter", 0.95, "seed");
        this.relations.addRelation("roboter", "has_need", "energie", 1, "seed");
        this.relations.addRelation("akku_niedrig", "requires", "ladestation", 1, "seed");
        this.relations.addRelation("sammelbehaelter_voll", "requires", "basis", 1, "seed");
        this.relations.addRelation("lebewesen", "requires", "sicherheitsabstand", 1, "seed");

        // Affordances: Was kann/soll man mit Dingen tun?
        this.affordances.addAffordance("muell", "collect", 0.95, "Müll soll eingesammelt werden.");
        this.affordances.addAffordance("muell", "dispose", 0.95, "Müll gehört in den Sammelbehälter.");

        this.affordances.addAffordance("plastikflasche", "grasp", 0.9, "Flaschen sind meist greifbar.");
        this.affordances.addAffordance("dose", "grasp", 0.88, "Dosen sind meist greifbar.");
        this.affordances.addAffordance("papier", "grasp", 0.65, "Papier kann gegriffen werden, ist aber flach.");
        this.affordances.addAffordance("tuete", "grasp", 0.72, "Tüten sind greifbar, aber flexibel.");
        this.affordances.addAffordance("verpackung", "grasp", 0.8, "Verpackungen sind meist greifbar.");

        this.affordances.addAffordance("ladestation", "charge", 1, "Die Ladestation lädt den Akku.");
        this.affordances.addAffordance("ladestation", "return_home", 1, "Die Ladestation ist die Basis.");

        this.affordances.addAffordance("stein", "blocks_path", 0.8, "Steine können Wege blockieren.");
        this.affordances.addAffordance("baum", "blocks_path", 0.95, "Bäume blockieren Wege.");
        this.affordances.addAffordance("hindernis", "blocks_path", 1, "Hindernisse blockieren Wege.");

        this.affordances.addAffordance("mensch", "keep_distance", 1, "Menschen dürfen nicht gefährdet werden.");
        this.affordances.addAffordance("tier", "keep_distance", 1, "Tiere sollen nicht gestört werden.");
        this.affordances.addAffordance("lebewesen", "avoid", 0.85, "Lebewesen haben Sicherheitspriorität.");
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