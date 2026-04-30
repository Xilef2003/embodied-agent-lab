import { ACTION, ENTITY } from "../config.js";

export class ExperienceLearner {
    constructor(options = {}) {
        this.config = {
            positiveLearningRate: 0.07,
            negativeLearningRate: 0.04,
            physicalLimitLearningRate: 0.16,
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

        // Erfolgreicher Pickup schwächt harte Negativannahmen leicht ab.
        semanticMemory.weakenAffordance(
            concept,
            "difficult_to_grasp",
            this.config.negativeLearningRate * 0.5,
            "Trotz möglicher Schwierigkeit erfolgreich gegriffen."
        );

        const collectAfter = semanticMemory.affordances.getConfidence(concept, "collect");
        const graspAfter = semanticMemory.affordances.getConfidence(concept, "grasp");

        events.push({
            kind: "pickup_success",
            concept,
            entityId: target.id,
            label: target.label || target.props?.label,
            message: `${target.label || target.props?.label || concept} erfolgreich gesammelt: collect/grasp verstärkt.`,
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
                label: target.label || target.props?.label,
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

        const target =
            result.target ||
            (action.targetId ? worldModel.knownEntities.get(action.targetId) : null);

        if (!target) {
            return events;
        }

        const concept = semanticMemory.entityToConcept(target);
        const label = target.label || target.props?.label || concept;
        const failureReason = result.failureReason || "pickup_failed";

        const graspBefore = semanticMemory.affordances.getConfidence(concept, "grasp");
        const difficultBefore = semanticMemory.affordances.getConfidence(concept, "difficult_to_grasp");
        const tooHeavyBefore = semanticMemory.affordances.getConfidence(concept, "too_heavy");
        const tooLargeBefore = semanticMemory.affordances.getConfidence(concept, "too_large");

        semanticMemory.weakenAffordance(
            concept,
            "grasp",
            this.config.negativeLearningRate,
            "Pickup ist fehlgeschlagen."
        );

        semanticMemory.reinforceAffordance(
            concept,
            "difficult_to_grasp",
            this.config.negativeLearningRate,
            "Pickup ist fehlgeschlagen."
        );

        if (failureReason === "too_heavy") {
            semanticMemory.reinforceAffordance(
                concept,
                "too_heavy",
                this.config.physicalLimitLearningRate,
                "Objekt überschreitet Traglimit."
            );

            semanticMemory.reinforceAffordance(
                concept,
                "difficult_to_grasp",
                this.config.physicalLimitLearningRate * 0.5,
                "Zu schwer für stabilen Pickup."
            );

            events.push({
                kind: "physical_limit_too_heavy",
                concept,
                entityId: target.id,
                label,
                message: `${label} war zu schwer: too_heavy/difficult_to_grasp verstärkt.`,
                failureReason,
                confidenceChanges: [
                    {
                        affordance: "too_heavy",
                        before: tooHeavyBefore,
                        after: semanticMemory.affordances.getConfidence(concept, "too_heavy")
                    },
                    {
                        affordance: "grasp",
                        before: graspBefore,
                        after: semanticMemory.affordances.getConfidence(concept, "grasp")
                    }
                ]
            });

            return events;
        }

        if (failureReason === "too_large") {
            semanticMemory.reinforceAffordance(
                concept,
                "too_large",
                this.config.physicalLimitLearningRate,
                "Objekt überschreitet Greifergröße."
            );

            semanticMemory.reinforceAffordance(
                concept,
                "difficult_to_grasp",
                this.config.physicalLimitLearningRate * 0.5,
                "Zu groß für stabilen Pickup."
            );

            events.push({
                kind: "physical_limit_too_large",
                concept,
                entityId: target.id,
                label,
                message: `${label} war zu groß: too_large/difficult_to_grasp verstärkt.`,
                failureReason,
                confidenceChanges: [
                    {
                        affordance: "too_large",
                        before: tooLargeBefore,
                        after: semanticMemory.affordances.getConfidence(concept, "too_large")
                    },
                    {
                        affordance: "grasp",
                        before: graspBefore,
                        after: semanticMemory.affordances.getConfidence(concept, "grasp")
                    }
                ]
            });

            return events;
        }

        if (failureReason === "grip_failed") {
            semanticMemory.reinforceAffordance(
                concept,
                "difficult_to_grasp",
                this.config.negativeLearningRate * 1.5,
                "Objekt ist beim Greifen entglitten."
            );

            events.push({
                kind: "grip_failure",
                concept,
                entityId: target.id,
                label,
                message: `${label} ist beim Greifen entglitten: difficult_to_grasp verstärkt.`,
                failureReason,
                confidenceChanges: [
                    {
                        affordance: "difficult_to_grasp",
                        before: difficultBefore,
                        after: semanticMemory.affordances.getConfidence(concept, "difficult_to_grasp")
                    },
                    {
                        affordance: "grasp",
                        before: graspBefore,
                        after: semanticMemory.affordances.getConfidence(concept, "grasp")
                    }
                ]
            });

            return events;
        }

        events.push({
            kind: "pickup_failure",
            concept,
            entityId: target.id,
            label,
            message: `Pickup bei ${label} fehlgeschlagen: grasp abgeschwächt.`,
            failureReason,
            confidenceChanges: [
                {
                    affordance: "grasp",
                    before: graspBefore,
                    after: semanticMemory.affordances.getConfidence(concept, "grasp")
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
            label: blocker.label || blocker.props?.label,
            message: `${blocker.label || blocker.props?.label || concept} blockierte Bewegung: blocks_path verstärkt.`,
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
                label: blocker.label || blocker.props?.label,
                message: `${blocker.label || blocker.props?.label || concept}: keep_distance/avoid verstärkt.`,
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