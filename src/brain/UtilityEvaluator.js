import { manhattan } from "../utils/Grid.js";

export class UtilityEvaluator {
    constructor(options = {}) {
        this.config = {
            moveCostEstimate: 0.7,
            reserveBattery: 14,
            maxUsefulDistance: 28,
            nearbyRiskDistance: 3,
            ...options
        };
    }

    evaluate(semantic, robot, worldModel, experienceSummary) {
        if (!semantic) {
            return semantic;
        }

        const rankedCollectableTargets = this.rankCollectableTargets(
            semantic.collectableTargets || [],
            semantic.hazards || [],
            robot,
            worldModel,
            experienceSummary
        );

        const decisionExplanation = this._makeDecisionExplanation(
            rankedCollectableTargets,
            robot,
            worldModel
        );

        return {
            ...semantic,

            // Kompatibilität:
            // GoalSystem und Planner nutzen weiterhin collectableTargets[0],
            // aber die Liste ist jetzt nach strategischem Nutzen sortiert.
            collectableTargets: rankedCollectableTargets,

            utility: {
                rankedCollectableTargets,
                topCollectableTarget: rankedCollectableTargets[0] || null,
                decisionExplanation
            }
        };
    }

    rankCollectableTargets(targets, hazards, robot, worldModel, experienceSummary) {
        return targets
            .map(target => this._scoreTarget(target, hazards, robot, worldModel, experienceSummary))
            .sort((a, b) => b.utility.score - a.utility.score);
    }

    _scoreTarget(target, hazards, robot, worldModel, experienceSummary) {
        const entity = target.entity;
        const home = worldModel.home;
        const body = robot.body;

        const distanceToTarget = manhattan(robot.position, entity);
        const distanceTargetToHome = home ? manhattan(entity, home) : 0;

        const estimatedMissionCost = home
            ? (distanceToTarget + distanceTargetToHome) * this.config.moveCostEstimate + this.config.reserveBattery
            : distanceToTarget * this.config.moveCostEstimate + this.config.reserveBattery;

        const energyMargin = body.battery - estimatedMissionCost;
        const isEnergyViable = energyMargin >= 0;

        const profile = experienceSummary?.getProfile(target.concept) || null;

        const collectConfidence = this._affordanceConfidence(target, "collect", 0.5);
        const graspConfidence = this._affordanceConfidence(target, "grasp", 0.5);

        const pickupSuccessRate =
            profile && profile.pickupAttempts > 0
                ? profile.pickupSuccessRate
                : null;

        const successScore =
            pickupSuccessRate !== null
                ? this._clamp(pickupSuccessRate * 0.65 + graspConfidence * 0.35)
                : this._clamp(graspConfidence * 0.7 + collectConfidence * 0.3);

        const distanceScore = this._clamp(
            1 - distanceToTarget / this.config.maxUsefulDistance
        );

        const energyScore = this._clamp(
            isEnergyViable
                ? 0.65 + Math.min(0.35, energyMargin / 50)
                : Math.max(0, body.battery / Math.max(1, estimatedMissionCost)) * 0.45
        );

        const learningValue = this._learningValue(profile);
        const riskPenalty = this._riskPenaltyNearTarget(entity, hazards);
        const loadPenalty = body.loadRatio >= 0.85 ? 0.35 : 0;

        const weighted = {
            success: successScore * 0.32,
            energy: energyScore * 0.25,
            distance: distanceScore * 0.22,
            learning: learningValue * 0.13,
            collect: collectConfidence * 0.08,
            risk: -riskPenalty,
            load: -loadPenalty
        };

        const rawScore =
            weighted.success +
            weighted.energy +
            weighted.distance +
            weighted.learning +
            weighted.collect +
            weighted.risk +
            weighted.load;

        const score = this._clamp(rawScore);

        const breakdown = this._makeBreakdown({
            target,
            profile,
            collectConfidence,
            graspConfidence,
            pickupSuccessRate,
            successScore,
            distanceScore,
            energyScore,
            learningValue,
            riskPenalty,
            loadPenalty,
            weighted,
            distanceToTarget,
            distanceTargetToHome,
            estimatedMissionCost,
            energyMargin,
            isEnergyViable,
            score
        });

        return {
            ...target,
            utility: {
                score,
                rawScore,
                scorePercent: Math.round(score * 100),
                isEnergyViable,
                distanceToTarget,
                distanceTargetToHome,
                estimatedMissionCost,
                energyMargin,
                successScore,
                distanceScore,
                energyScore,
                learningValue,
                riskPenalty,
                loadPenalty,
                pickupSuccessRate,
                collectConfidence,
                graspConfidence,
                weighted,
                breakdown,
                explanation: this._makeShortExplanation({
                    target,
                    score,
                    isEnergyViable,
                    distanceToTarget,
                    estimatedMissionCost,
                    energyMargin,
                    successScore,
                    learningValue,
                    riskPenalty,
                    loadPenalty,
                    pickupSuccessRate
                }),
                detailedExplanation: this._makeDetailedExplanation(target, score, breakdown)
            }
        };
    }

    _makeBreakdown(data) {
        const {
            profile,
            collectConfidence,
            graspConfidence,
            pickupSuccessRate,
            successScore,
            distanceScore,
            energyScore,
            learningValue,
            riskPenalty,
            loadPenalty,
            weighted,
            distanceToTarget,
            distanceTargetToHome,
            estimatedMissionCost,
            energyMargin,
            isEnergyViable
        } = data;

        const items = [];

        items.push({
            id: "success",
            label: "Erfolgswahrscheinlichkeit",
            direction: "plus",
            rawValue: successScore,
            weight: 0.32,
            contribution: weighted.success,
            text: pickupSuccessRate !== null
                ? `Erfahrung sagt ${Math.round(pickupSuccessRate * 100)}% Pickup-Erfolg.`
                : `Noch wenig Erfahrung; Schätzung aus grasp/collect.`
        });

        items.push({
            id: "energy",
            label: "Energie",
            direction: isEnergyViable ? "plus" : "minus",
            rawValue: energyScore,
            weight: 0.25,
            contribution: weighted.energy,
            text: isEnergyViable
                ? `Akku reicht. Reserve nach Mission ca. ${Math.round(energyMargin)}%.`
                : `Akku knapp. Geschätzte Missionskosten: ${Math.round(estimatedMissionCost)}%.`
        });

        items.push({
            id: "distance",
            label: "Distanz",
            direction: "plus",
            rawValue: distanceScore,
            weight: 0.22,
            contribution: weighted.distance,
            text: `Ziel ist ${distanceToTarget} Felder entfernt. Rückweg danach: ${distanceTargetToHome} Felder.`
        });

        items.push({
            id: "learning",
            label: "Lernwert",
            direction: "plus",
            rawValue: learningValue,
            weight: 0.13,
            contribution: weighted.learning,
            text: profile
                ? `Es gibt bereits ${profile.totalEvents} Erfahrung(en) mit diesem Konzept.`
                : `Neues/kaum bekanntes Konzept: hoher Lernwert.`
        });

        items.push({
            id: "collect",
            label: "Sammelbarkeit",
            direction: "plus",
            rawValue: collectConfidence,
            weight: 0.08,
            contribution: weighted.collect,
            text: `collect: ${Math.round(collectConfidence * 100)}%, grasp: ${Math.round(graspConfidence * 100)}%.`
        });

        if (riskPenalty > 0) {
            items.push({
                id: "risk",
                label: "Risiko",
                direction: "minus",
                rawValue: riskPenalty,
                weight: 1,
                contribution: weighted.risk,
                text: `In der Nähe des Ziels befindet sich ein Risiko. Strafe: ${Math.round(riskPenalty * 100)}%.`
            });
        } else {
            items.push({
                id: "risk",
                label: "Risiko",
                direction: "neutral",
                rawValue: 0,
                weight: 1,
                contribution: 0,
                text: "Kein nahes Risiko am Ziel bekannt."
            });
        }

        if (loadPenalty > 0) {
            items.push({
                id: "load",
                label: "Behälterfüllstand",
                direction: "minus",
                rawValue: loadPenalty,
                weight: 1,
                contribution: weighted.load,
                text: `Behälter fast voll. Strafe: ${Math.round(loadPenalty * 100)}%.`
            });
        } else {
            items.push({
                id: "load",
                label: "Behälterfüllstand",
                direction: "neutral",
                rawValue: 0,
                weight: 1,
                contribution: 0,
                text: "Behälter hat genug freie Kapazität."
            });
        }

        return items;
    }

    _makeDecisionExplanation(rankedTargets, robot, worldModel) {
        const selected = rankedTargets[0] || null;

        if (!selected) {
            return {
                type: "no_collectable_target",
                title: "Kein sammelbares Ziel bekannt",
                summary: "Der Agent kennt aktuell kein semantisch sammelbares Ziel.",
                selected: null,
                comparedTargets: []
            };
        }

        const comparedTargets = rankedTargets.slice(0, 5).map(target => ({
            id: target.id,
            label: target.label,
            concept: target.concept,
            score: target.utility.score,
            scorePercent: target.utility.scorePercent,
            distanceToTarget: target.utility.distanceToTarget,
            isEnergyViable: target.utility.isEnergyViable,
            explanation: target.utility.explanation,
            strongestPros: this._strongestFactors(target.utility.breakdown, "plus", 2),
            strongestCons: this._strongestFactors(target.utility.breakdown, "minus", 2)
        }));

        return {
            type: "collect_target_selection",
            title: `Gewähltes Ziel: ${selected.label}`,
            summary:
                `${selected.label} wurde gewählt, weil es im Vergleich den höchsten Nutzen hat ` +
                `(${selected.utility.scorePercent}%).`,
            selected: {
                id: selected.id,
                label: selected.label,
                concept: selected.concept,
                score: selected.utility.score,
                scorePercent: selected.utility.scorePercent,
                explanation: selected.utility.explanation,
                detailedExplanation: selected.utility.detailedExplanation,
                breakdown: selected.utility.breakdown
            },
            comparedTargets,
            robotState: {
                battery: robot.body.battery,
                trashLoad: robot.body.trashLoad,
                maxTrashLoad: robot.body.maxTrashLoad,
                homeKnown: Boolean(worldModel.home)
            }
        };
    }

    _strongestFactors(breakdown, direction, limit = 2) {
        return breakdown
            .filter(item => item.direction === direction)
            .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
            .slice(0, limit)
            .map(item => ({
                label: item.label,
                contribution: item.contribution,
                text: item.text
            }));
    }

    _makeShortExplanation(data) {
        const parts = [];

        parts.push(`Nutzen ${Math.round(data.score * 100)}%`);
        parts.push(`Distanz ${data.distanceToTarget}`);

        if (data.pickupSuccessRate !== null) {
            parts.push(`Erfahrung ${Math.round(data.pickupSuccessRate * 100)}%`);
        } else {
            parts.push(`Greifschätzung ${Math.round(data.successScore * 100)}%`);
        }

        if (data.isEnergyViable) {
            parts.push("Akku reicht");
        } else {
            parts.push("Akku knapp");
        }

        if (data.riskPenalty > 0) {
            parts.push("Risiko nahe Ziel");
        }

        if (data.loadPenalty > 0) {
            parts.push("Behälter fast voll");
        }

        if (data.learningValue > 0.2) {
            parts.push("Lernwert hoch");
        }

        return parts.join(" · ");
    }

    _makeDetailedExplanation(target, score, breakdown) {
        const plus = breakdown
            .filter(item => item.direction === "plus")
            .sort((a, b) => b.contribution - a.contribution);

        const minus = breakdown
            .filter(item => item.direction === "minus")
            .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

        const neutral = breakdown
            .filter(item => item.direction === "neutral");

        return {
            title: `${target.label} (${target.concept})`,
            scorePercent: Math.round(score * 100),
            plus,
            minus,
            neutral,
            summary:
                `${target.label} erreicht ${Math.round(score * 100)}% Utility. ` +
                `Die stärksten positiven Faktoren sind ${plus.slice(0, 2).map(item => item.label).join(" und ") || "keine"}. ` +
                `Die stärksten negativen Faktoren sind ${minus.slice(0, 2).map(item => item.label).join(" und ") || "keine"}.`
        };
    }

    _learningValue(profile) {
        if (!profile) {
            return 0.85;
        }

        if (profile.totalEvents <= 0) {
            return 0.85;
        }

        if (profile.pickupAttempts === 0) {
            return 0.7;
        }

        return this._clamp(0.55 / (1 + profile.pickupAttempts * 0.45));
    }

    _riskPenaltyNearTarget(entity, hazards) {
        let penalty = 0;

        for (const hazard of hazards || []) {
            const hazardEntity = hazard.entity || hazard;
            const distance = manhattan(entity, hazardEntity);

            if (distance <= 1) {
                penalty = Math.max(penalty, 0.65);
            } else if (distance <= 2) {
                penalty = Math.max(penalty, 0.4);
            } else if (distance <= this.config.nearbyRiskDistance) {
                penalty = Math.max(penalty, 0.22);
            }
        }

        return penalty;
    }

    _affordanceConfidence(target, affordance, fallback = 0) {
        const found = target.affordances?.find(item => item.affordance === affordance);
        return found?.confidence ?? fallback;
    }

    _clamp(value) {
        return Math.max(0, Math.min(1, value));
    }
}