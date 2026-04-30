import { ACTION, ENTITY } from "../config.js";

export class ExperienceLearner {
    constructor(options = {}) {
        this.config = {
            positiveLearningRate: 0.07,
            negativeLearningRate: 0.04,
            relationConfidenceFromExperience: 0.72,
            maxEvents: 120,
            ...options
        };

        this.events = [];
    }

    learn(action, result, observation, robot, worldModel, semanticMemory) {
        if (!action || !result || !semanticMemory) return [];

        const producedEvents = [];

        if (result.ok && result.type === ACTION.PICKUP && result.target) {
            producedEvents.push(
                ...this._learnPickupSuccess(result.target, semanticMemory)
            );
        }

        if (!result.ok && action.type === ACTION.PICKUP) {
            producedEvents.push(
                ...this._learnPickupFailure(action, result, worldModel, semanticMemory)
            );
        }

        if (!result.ok && action.type === ACTION.MOVE && result.blocker) {
            producedEvents.push(
                ...this._learnBlockedMovement(result.blocker, semanticMemory)
            );
        }

        if (result.ok && result.type === ACTION.CHARGE) {
            producedEvents.push(
                ...this._learnChargeSuccess(semanticMemory)
            );
        }

        if (result.ok && result.type === ACTION.EMPTY) {
            producedEvents.push(
                ...this._learnEmptySuccess(semanticMemory)
            );
        }

        for (const event of producedEvents) {
            this._recordEvent(event);
        }

        return producedEvents;
    }

    getState() {
        return {
            eventCount: this.events.length,
            recentEvents: this.events.slice(-10)
        };
    }

    _learnPickupSuccess(target, semanticMemory) {
        const concept = semanticMemory.entityToConcept(target);
        const events = [];

        const collectBefore = semanticMemory.affordances.getConfidence(concept, "collect");
        const graspBefore = semanticMemory.affordances.getConfidence(concept, "grasp");

        semanticMemory.reinforceAffordance(
            concept,
            "collect",
            this.config.positiveLearningRate,
            "Pickup war erfolgreich."
        );

        semanticMemory.reinforceAffordance(
            concept,
            "grasp",
            this.config.positiveLearningRate,
            "Greifen war erfolgreich."
        );

        const collectAfter = semanticMemory.affordances.getConfidence(concept, "collect");
        const graspAfter = semanticMemory.affordances.getConfidence(concept, "grasp");

        events.push({
            kind: "pickup_success",
            concept,
            entityId: target.id,
            label: target.label,
            message: `${target.label} erfolgreich gesammelt: collect/grasp verstärkt.`,
            confidenceChanges: [
                {
                    affordance: "collect",
                    before: collectBefore,
                    after: collectAfter
                },
                {
                    affordance: "grasp",
                    before: graspBefore,
                    after: graspAfter
                }
            ]
        });

        if (target.type === ENTITY.TRASH && !semanticMemory.hasRelation(concept, "is_a", "muell")) {
            semanticMemory.addRelation(
                concept,
                "is_a",
                "muell",
                this.config.relationConfidenceFromExperience,
                "experience",
                "pickup_success"
            );

            events.push({
                kind: "relation_learned",
                concept,
                entityId: target.id,
                label: target.label,
                message: `${concept} wurde durch Erfahrung als Müll klassifiziert.`
            });
        }

        return events;
    }

    _learnPickupFailure(action, result, worldModel, semanticMemory) {
        const events = [];

        if (result.message?.toLowerCase().includes("behälter")) {
            return events;
        }

        if (result.message?.toLowerCase().includes("zu weit")) {
            return events;
        }

        const target = action.targetId
            ? worldModel.knownEntities.get(action.targetId)
            : null;

        if (!target) {
            return events;
        }

        const concept = semanticMemory.entityToConcept(target);
        const graspBefore = semanticMemory.affordances.getConfidence(concept, "grasp");

        semanticMemory.weakenAffordance(
            concept,
            "grasp",
            this.config.negativeLearningRate,
            "Pickup ist fehlgeschlagen."
        );

        const graspAfter = semanticMemory.affordances.getConfidence(concept, "grasp");

        events.push({
            kind: "pickup_failure",
            concept,
            entityId: target.id,
            label: target.label,
            message: `Pickup bei ${target.label} fehlgeschlagen: grasp leicht abgeschwächt.`,
            confidenceChanges: [
                {
                    affordance: "grasp",
                    before: graspBefore,
                    after: graspAfter
                }
            ]
        });

        return events;
    }

    _learnBlockedMovement(blocker, semanticMemory) {
        const concept = semanticMemory.entityToConcept(blocker);
        const events = [];

        const blocksBefore = semanticMemory.affordances.getConfidence(concept, "blocks_path");

        semanticMemory.reinforceAffordance(
            concept,
            "blocks_path",
            this.config.positiveLearningRate,
            "Bewegung wurde blockiert."
        );

        const blocksAfter = semanticMemory.affordances.getConfidence(concept, "blocks_path");

        events.push({
            kind: "blocked_movement",
            concept,
            entityId: blocker.id,
            label: blocker.label,
            message: `${blocker.label} blockierte Bewegung: blocks_path verstärkt.`,
            confidenceChanges: [
                {
                    affordance: "blocks_path",
                    before: blocksBefore,
                    after: blocksAfter
                }
            ]
        });

        if (blocker.type === ENTITY.HUMAN || blocker.type === ENTITY.ANIMAL) {
            const keepDistanceBefore = semanticMemory.affordances.getConfidence(concept, "keep_distance");
            const avoidBefore = semanticMemory.affordances.getConfidence(concept, "avoid");

            semanticMemory.reinforceAffordance(
                concept,
                "keep_distance",
                this.config.positiveLearningRate,
                "Lebewesen in Bewegungszone."
            );

            semanticMemory.reinforceAffordance(
                concept,
                "avoid",
                this.config.positiveLearningRate,
                "Lebewesen soll nicht gestört werden."
            );

            const keepDistanceAfter = semanticMemory.affordances.getConfidence(concept, "keep_distance");
            const avoidAfter = semanticMemory.affordances.getConfidence(concept, "avoid");

            events.push({
                kind: "safety_learning",
                concept,
                entityId: blocker.id,
                label: blocker.label,
                message: `${blocker.label}: keep_distance/avoid verstärkt.`,
                confidenceChanges: [
                    {
                        affordance: "keep_distance",
                        before: keepDistanceBefore,
                        after: keepDistanceAfter
                    },
                    {
                        affordance: "avoid",
                        before: avoidBefore,
                        after: avoidAfter
                    }
                ]
            });
        }

        return events;
    }

    _learnChargeSuccess(semanticMemory) {
        const chargeBefore = semanticMemory.affordances.getConfidence("ladestation", "charge");

        semanticMemory.reinforceAffordance(
            "ladestation",
            "charge",
            this.config.positiveLearningRate,
            "Laden war erfolgreich."
        );

        const chargeAfter = semanticMemory.affordances.getConfidence("ladestation", "charge");

        return [
            {
                kind: "charge_success",
                concept: "ladestation",
                label: "Ladestation",
                message: "Ladestation erfolgreich genutzt: charge verstärkt.",
                confidenceChanges: [
                    {
                        affordance: "charge",
                        before: chargeBefore,
                        after: chargeAfter
                    }
                ]
            }
        ];
    }

    _learnEmptySuccess(semanticMemory) {
        const returnHomeBefore = semanticMemory.affordances.getConfidence("ladestation", "return_home");
        const emptyAtBaseBefore = semanticMemory.affordances.getConfidence("sammelbehaelter", "empty_at_base");

        semanticMemory.reinforceAffordance(
            "ladestation",
            "return_home",
            this.config.positiveLearningRate,
            "Basis konnte zum Entladen genutzt werden."
        );

        semanticMemory.reinforceAffordance(
            "sammelbehaelter",
            "empty_at_base",
            this.config.positiveLearningRate,
            "Behälter wurde an der Basis geleert."
        );

        const returnHomeAfter = semanticMemory.affordances.getConfidence("ladestation", "return_home");
        const emptyAtBaseAfter = semanticMemory.affordances.getConfidence("sammelbehaelter", "empty_at_base");

        return [
            {
                kind: "empty_success",
                concept: "sammelbehaelter",
                label: "Sammelbehälter",
                message: "Entladen an Basis erfolgreich: empty_at_base verstärkt.",
                confidenceChanges: [
                    {
                        affordance: "return_home",
                        before: returnHomeBefore,
                        after: returnHomeAfter
                    },
                    {
                        affordance: "empty_at_base",
                        before: emptyAtBaseBefore,
                        after: emptyAtBaseAfter
                    }
                ]
            }
        ];
    }

    _recordEvent(event) {
        this.events.push({
            ...event,
            time: Date.now()
        });

        if (this.events.length > this.config.maxEvents) {
            this.events.shift();
        }
    }
}