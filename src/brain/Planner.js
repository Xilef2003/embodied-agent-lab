import { GOAL } from "../config.js";
import { manhattan } from "../utils/Grid.js";

/**
 * GoalSystem v1.1
 *
 * Neu:
 * - SpatialMemory:
 *   Wenn kein direktes Sammelziel aktiv ist, kann der Agent gezielt
 *   interessante Regionen erneut prüfen.
 *
 * - Patrol Area:
 *   "Dort habe ich früher Müll/Tiere/Ungewissheit gesehen,
 *    also schaue ich dort wieder nach."
 */
export class GoalSystem {
    constructor(options = {}) {
        this.config = {
            chargeUntilRatio: 0.82,
            leaveBaseMinBatteryRatio: 0.55,
            reserveBattery: 14,
            moveCostEstimate: 0.7,
            missionCoverageThreshold: 0.88,
            maxTicksWithoutKnownTrash: 180,
            minUtilityToStartMission: 0.18,

            safetyTriggerDistance: 1,
            safetyReleaseDistance: 3,

            minPatrolScore: 0.28,

            ...options
        };

        this.committedGoal = null;
        this.committedSafetyTargetId = null;
        this.ticksWithoutKnownTrash = 0;
    }

    choose(needs, emotions, robot, worldModel, semantic = null, spatial = null) {
        const body = robot.body;
        const position = robot.position;
        const home = worldModel.home;
        const atHome = Boolean(home && manhattan(position, home) === 0);

        const semanticHazards = semantic?.hazards || [];
        const nearestHazard = semanticHazards[0] || null;

        const immediateHazard = semanticHazards.find(
            hazard => hazard.distance <= this.config.safetyTriggerDistance
        );

        const committedHazard = this.committedSafetyTargetId
            ? semanticHazards.find(hazard => hazard.id === this.committedSafetyTargetId)
            : null;

        const collectableTargets = semantic?.collectableTargets || [];
        const viableTargets = collectableTargets.filter(item =>
            item.utility?.isEnergyViable !== false &&
            (item.utility?.score ?? 0) >= this.config.minUtilityToStartMission
        );

        const bestUtilityTarget = viableTargets[0] || collectableTargets[0] || null;
        const nearestTarget = bestUtilityTarget?.entity || null;

        const fallbackKnownTrash = worldModel.getKnownTrash();
        const fallbackNearestTrash = worldModel.getNearestKnownTrash(position);

        const knownTargetCount = collectableTargets.length || fallbackKnownTrash.length;
        const targetForMission = nearestTarget || fallbackNearestTrash;

        const bestPatrolRegion = spatial?.bestPatrolRegion || null;

        const knownCoverage = worldModel.getKnownCellRatio();

        this._updateMissionMemory(knownTargetCount);

        const suppressedBase = this._makeSuppressedOptions({
            body,
            atHome,
            nearestTarget: bestUtilityTarget,
            home,
            knownTargetCount,
            knownCoverage,
            needs,
            bestPatrolRegion
        });

        // 1. Safety Commitment bleibt aktiv, bis Abstand wirklich wiederhergestellt ist.
        if (this.committedGoal === GOAL.AVOID) {
            const hazard = committedHazard || nearestHazard;

            if (hazard && hazard.distance < this.config.safetyReleaseDistance) {
                return {
                    type: GOAL.AVOID,
                    priority: 1,
                    hazardId: hazard.id,
                    hazardLabel: hazard.label,
                    safeDistance: this.config.safetyReleaseDistance,
                    reason:
                        `Sicherheitsmodus bleibt aktiv: ${hazard.label} ist noch ` +
                        `${hazard.distance} Feld(er) entfernt.`,
                    explanation: this._explainActiveDecision({
                        activeGoal: GOAL.AVOID,
                        title: "Aktive Entscheidung: Sicherheit",
                        summary:
                            `Der Agent hält weiter Abstand zu ${hazard.label}. ` +
                            `Er wechselt erst zurück, wenn mindestens ` +
                            `${this.config.safetyReleaseDistance} Felder Abstand erreicht sind.`,
                        priority: "safety",
                        evidence: [
                            `${hazard.label} Distanz: ${hazard.distance}`,
                            `Caution: ${emotions.caution.toFixed(2)}`,
                            `Safety-Release-Distanz: ${this.config.safetyReleaseDistance}`
                        ],
                        suppressedGoals: suppressedBase
                    })
                };
            }

            this.committedGoal = null;
            this.committedSafetyTargetId = null;
        }

        // 2. Sicherheit überschreibt alles.
        if (immediateHazard && emotions.caution > 0.35) {
            this.committedGoal = GOAL.AVOID;
            this.committedSafetyTargetId = immediateHazard.id;

            return {
                type: GOAL.AVOID,
                priority: 1,
                hazardId: immediateHazard.id,
                hazardLabel: immediateHazard.label,
                safeDistance: this.config.safetyReleaseDistance,
                reason: `Direktes Risiko in der Nähe: ${immediateHazard.label}.`,
                explanation: this._explainActiveDecision({
                    activeGoal: GOAL.AVOID,
                    title: "Aktive Entscheidung: Sicherheits-Override",
                    summary:
                        `${immediateHazard.label} ist zu nah. Sicherheit überschreibt ` +
                        `Entladen, Sammeln, Erkunden, Patrouille und Laden.`,
                    priority: "safety",
                    evidence: [
                        `${immediateHazard.label} Distanz: ${immediateHazard.distance}`,
                        `Caution: ${emotions.caution.toFixed(2)}`,
                        `Safety-Trigger-Distanz: ${this.config.safetyTriggerDistance}`
                    ],
                    suppressedGoals: suppressedBase
                })
            };
        }

        // 3. Entladen bleibt aktiv, bis der Behälter leer ist.
        if (this.committedGoal === GOAL.EMPTY_LOAD) {
            if (body.trashLoad > 0) {
                return {
                    type: GOAL.EMPTY_LOAD,
                    priority: 0.96,
                    reason: "Entlade-Ziel wird beibehalten, bis der Behälter leer ist.",
                    explanation: this._explainActiveDecision({
                        activeGoal: GOAL.EMPTY_LOAD,
                        title: "Aktive Entscheidung: Entladen fortsetzen",
                        summary:
                            "Der Behälter enthält noch Müll. Der Agent bleibt beim Ziel, " +
                            "zur Basis zu fahren und zu entladen.",
                        priority: "body_state",
                        evidence: [
                            `Müllbehälter: ${body.trashLoad}/${body.maxTrashLoad}`,
                            `Home bekannt: ${home ? "ja" : "nein"}`
                        ],
                        suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.EMPTY_LOAD)
                    })
                };
            }

            this.committedGoal = null;
        }

        if (body.isLoadFull) {
            this.committedGoal = GOAL.EMPTY_LOAD;

            return {
                type: GOAL.EMPTY_LOAD,
                priority: 0.96,
                reason: "Müllbehälter ist voll.",
                explanation: this._explainActiveDecision({
                    activeGoal: GOAL.EMPTY_LOAD,
                    title: "Aktive Entscheidung: Behälter voll",
                    summary:
                        "Der Agent kann keine weiteren Objekte aufnehmen. " +
                        "Entladen hat Vorrang vor Sammeln und Patrouille.",
                    priority: "body_state",
                    evidence: [
                        `Müllbehälter: ${body.trashLoad}/${body.maxTrashLoad}`,
                        `Bestes Sammelziel wäre: ${bestUtilityTarget?.label || "-"}`
                    ],
                    suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.EMPTY_LOAD)
                })
            };
        }

        if (atHome && body.trashLoad > 0) {
            this.committedGoal = GOAL.EMPTY_LOAD;

            return {
                type: GOAL.EMPTY_LOAD,
                priority: 0.88,
                reason: "An der Basis: gesammelten Müll abgeben.",
                explanation: this._explainActiveDecision({
                    activeGoal: GOAL.EMPTY_LOAD,
                    title: "Aktive Entscheidung: Müll an Basis abgeben",
                    summary:
                        "Der Agent ist an der Basis und trägt Müll. " +
                        "Er entlädt, bevor er neue Ziele verfolgt.",
                    priority: "body_state",
                    evidence: [
                        "Position: Basis",
                        `Müllbehälter: ${body.trashLoad}/${body.maxTrashLoad}`
                    ],
                    suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.EMPTY_LOAD)
                })
            };
        }

        // 4. Laden bleibt aktiv, bis genug Akku da ist.
        if (this.committedGoal === GOAL.CHARGE) {
            if (!atHome || body.batteryRatio < this.config.chargeUntilRatio) {
                return {
                    type: GOAL.CHARGE,
                    priority: 1,
                    reason:
                        `Lade-Ziel wird beibehalten bis ` +
                        `${Math.round(this.config.chargeUntilRatio * 100)}% Akku.`,
                    explanation: this._explainActiveDecision({
                        activeGoal: GOAL.CHARGE,
                        title: "Aktive Entscheidung: Laden fortsetzen",
                        summary:
                            "Der Agent hat sich zum Laden verpflichtet und verlässt die Basis " +
                            "erst wieder, wenn genug Energie vorhanden ist.",
                        priority: "energy",
                        evidence: [
                            `Akku: ${Math.round(body.batteryRatio * 100)}%`,
                            `Ladeziel: ${Math.round(this.config.chargeUntilRatio * 100)}%`
                        ],
                        suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.CHARGE)
                    })
                };
            }

            this.committedGoal = null;
        }

        if (body.isBatteryCritical || needs.returnRisk > 0.35) {
            this.committedGoal = GOAL.CHARGE;

            return {
                type: GOAL.CHARGE,
                priority: 1,
                reason: "Akku kritisch oder Rückweg gefährdet.",
                explanation: this._explainActiveDecision({
                    activeGoal: GOAL.CHARGE,
                    title: "Aktive Entscheidung: Energie sichern",
                    summary:
                        "Der Agent priorisiert Selbsterhaltung. Akku oder Rückwegrisiko " +
                        "ist zu kritisch für weitere Missionen.",
                    priority: "energy",
                    evidence: [
                        `Akku: ${Math.round(body.batteryRatio * 100)}%`,
                        `Return Risk: ${needs.returnRisk.toFixed(2)}`
                    ],
                    suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.CHARGE)
                })
            };
        }

        if (atHome && body.batteryRatio < this.config.leaveBaseMinBatteryRatio) {
            this.committedGoal = GOAL.CHARGE;

            return {
                type: GOAL.CHARGE,
                priority: 0.92,
                reason:
                    `An Basis: vor neuer Mission mindestens ` +
                    `${Math.round(this.config.leaveBaseMinBatteryRatio * 100)}% Akku laden.`,
                explanation: this._explainActiveDecision({
                    activeGoal: GOAL.CHARGE,
                    title: "Aktive Entscheidung: Vor Mission aufladen",
                    summary:
                        "Der Agent ist an der Basis, aber die Energie reicht noch nicht " +
                        "für eine robuste neue Mission.",
                    priority: "energy",
                    evidence: [
                        `Akku: ${Math.round(body.batteryRatio * 100)}%`,
                        `Minimum zum Losfahren: ${Math.round(this.config.leaveBaseMinBatteryRatio * 100)}%`
                    ],
                    suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.CHARGE)
                })
            };
        }

        if (body.isBatteryLow && home) {
            this.committedGoal = GOAL.CHARGE;

            return {
                type: GOAL.CHARGE,
                priority: 0.9,
                reason: "Akku niedrig, Rückkehr zur Ladestation priorisiert.",
                explanation: this._explainActiveDecision({
                    activeGoal: GOAL.CHARGE,
                    title: "Aktive Entscheidung: Zur Ladestation zurückkehren",
                    summary:
                        "Der Akku ist niedrig. Der Agent bricht Missionen ab, " +
                        "bevor der Rückweg riskant wird.",
                    priority: "energy",
                    evidence: [
                        `Akku: ${Math.round(body.batteryRatio * 100)}%`,
                        "Home bekannt: ja"
                    ],
                    suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.CHARGE)
                })
            };
        }

        // 5. Utility-basiertes Sammelziel verfolgen.
        if (
            bestUtilityTarget &&
            targetForMission &&
            knownTargetCount > 0 &&
            !body.isLoadFull &&
            this._hasEnergyForMission(position, targetForMission, home, body)
        ) {
            this.committedGoal = null;

            const utility = bestUtilityTarget.utility;
            const score = utility ? `${utility.scorePercent}%` : "unbekannt";

            return {
                type: GOAL.COLLECT_TRASH,
                priority: 0.78,
                targetId: targetForMission.id,
                targetConcept: bestUtilityTarget.concept,
                targetLabel: bestUtilityTarget.label,
                utilityScore: utility?.score ?? null,
                reason:
                    `Bestes Sammelziel nach Utility: ${bestUtilityTarget.label} (${score}). ` +
                    `${utility?.explanation || ""}`,
                explanation: this._explainActiveDecision({
                    activeGoal: GOAL.COLLECT_TRASH,
                    title: "Aktive Entscheidung: Sammeln",
                    summary:
                        `${bestUtilityTarget.label} wurde als bestes Sammelziel gewählt.`,
                    priority: "mission",
                    evidence: [
                        `Utility: ${score}`,
                        `Konzept: ${bestUtilityTarget.concept}`,
                        `Distanz: ${utility?.distanceToTarget ?? "?"}`,
                        `Akku reicht: ${utility?.isEnergyViable ? "ja" : "nein"}`
                    ],
                    suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.COLLECT_TRASH)
                })
            };
        }

        // 6. Ziel bekannt, aber Energie/Utility reicht nicht.
        if (targetForMission && home) {
            this.committedGoal = GOAL.CHARGE;

            return {
                type: GOAL.CHARGE,
                priority: 0.87,
                reason: "Sammelbares Ziel bekannt, aber Energiebudget oder Utility reicht nicht.",
                explanation: this._explainActiveDecision({
                    activeGoal: GOAL.CHARGE,
                    title: "Aktive Entscheidung: Vor Sammelmission laden",
                    summary:
                        "Es gibt ein sammelbares Ziel, aber die Mission wäre energetisch " +
                        "oder strategisch zu schwach.",
                    priority: "energy",
                    evidence: [
                        `Bestes Ziel: ${bestUtilityTarget?.label || targetForMission.label || "-"}`,
                        `Akku: ${Math.round(body.batteryRatio * 100)}%`
                    ],
                    suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.CHARGE)
                })
            };
        }

        // 7. Neu: Patrouille zu interessanter Region.
        if (
            bestPatrolRegion &&
            bestPatrolRegion.finalScore >= this.config.minPatrolScore &&
            body.batteryRatio > 0.35 &&
            !body.isLoadFull
        ) {
            this.committedGoal = null;

            return {
                type: GOAL.PATROL_AREA,
                priority: 0.58,
                regionId: bestPatrolRegion.id,
                target: bestPatrolRegion.target,
                regionScore: bestPatrolRegion.finalScore,
                reason:
                    `Region ${bestPatrolRegion.id} erneut prüfen: ` +
                    `${bestPatrolRegion.summary}`,
                explanation: this._explainActiveDecision({
                    activeGoal: GOAL.PATROL_AREA,
                    title: "Aktive Entscheidung: Ort erneut prüfen",
                    summary:
                        `Region ${bestPatrolRegion.id} ist erinnerungsbasiert interessant. ` +
                        "Der Agent prüft sie erneut, weil dort früher relevante Muster vorkamen.",
                    priority: "spatial_memory",
                    evidence: [
                        `Regionsscore: ${Math.round(bestPatrolRegion.finalScore * 100)}%`,
                        `Müll gesehen: ${bestPatrolRegion.trashSeen}`,
                        `Müll gesammelt: ${bestPatrolRegion.trashCollected}`,
                        `Risiken gesehen: ${bestPatrolRegion.hazardSeen}`,
                        `Risiko: ${bestPatrolRegion.riskPercent}%`,
                        `Zusammenfassung: ${bestPatrolRegion.summary}`
                    ],
                    suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.PATROL_AREA)
                })
            };
        }

        // 8. Missionsabschluss.
        const missionLooksComplete = this._missionLooksComplete(knownCoverage, knownTargetCount);

        if (missionLooksComplete && knownTargetCount === 0) {
            this.committedGoal = null;

            if (atHome) {
                return {
                    type: GOAL.STANDBY,
                    priority: 0.7,
                    reason:
                        "Mission wirkt abgeschlossen: kein semantisch sammelbares Ziel " +
                        "und Basis erreicht.",
                    explanation: this._explainActiveDecision({
                        activeGoal: GOAL.STANDBY,
                        title: "Aktive Entscheidung: Standby",
                        summary:
                            "Der Agent kennt kein relevantes Ziel mehr und befindet sich an der Basis.",
                        priority: "mission_complete",
                        evidence: [
                            `Bekannte Welt: ${Math.round(knownCoverage * 100)}%`,
                            `Sammelbare Ziele: ${knownTargetCount}`
                        ],
                        suppressedGoals: []
                    })
                };
            }

            if (home) {
                return {
                    type: GOAL.RETURN_HOME,
                    priority: 0.76,
                    reason: "Kein semantisch sammelbares Ziel mehr. Kehre zur Basis zurück.",
                    explanation: this._explainActiveDecision({
                        activeGoal: GOAL.RETURN_HOME,
                        title: "Aktive Entscheidung: Mission abschließen",
                        summary:
                            "Der Agent findet keine sammelbaren Ziele mehr und kehrt zur Basis zurück.",
                        priority: "mission_complete",
                        evidence: [
                            `Bekannte Welt: ${Math.round(knownCoverage * 100)}%`,
                            `Sammelbare Ziele: ${knownTargetCount}`
                        ],
                        suppressedGoals: []
                    })
                };
            }
        }

        // 9. Standard: erkunden.
        this.committedGoal = null;

        return {
            type: GOAL.EXPLORE,
            priority: 0.45 + emotions.curiosity * 0.3,
            reason: "Unbekannte Weltbereiche erkunden.",
            explanation: this._explainActiveDecision({
                activeGoal: GOAL.EXPLORE,
                title: "Aktive Entscheidung: Erkunden",
                summary:
                    "Kein dringendes Körperziel, kein gutes Sammelziel und keine starke " +
                    "Patrouillenregion aktiv. Der Agent erweitert sein Weltmodell.",
                priority: "curiosity",
                evidence: [
                    `Curiosity: ${emotions.curiosity.toFixed(2)}`,
                    `Bekannte Welt: ${Math.round(knownCoverage * 100)}%`
                ],
                suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.EXPLORE)
            })
        };
    }

    _makeSuppressedOptions({ body, atHome, nearestTarget, home, knownTargetCount, knownCoverage, needs, bestPatrolRegion }) {
        const options = [];

        if (body.trashLoad > 0 || body.isLoadFull) {
            options.push({
                goal: GOAL.EMPTY_LOAD,
                label: "Entladen",
                reason:
                    body.isLoadFull
                        ? "Behälter ist voll."
                        : "Es befindet sich Müll im Behälter."
            });
        }

        if (body.isBatteryLow || body.isBatteryCritical || needs.returnRisk > 0.2) {
            options.push({
                goal: GOAL.CHARGE,
                label: "Laden",
                reason:
                    `Akku/Rückweg relevant. Akku: ${Math.round(body.batteryRatio * 100)}%, ` +
                    `Return Risk: ${needs.returnRisk.toFixed(2)}.`
            });
        }

        if (nearestTarget) {
            options.push({
                goal: GOAL.COLLECT_TRASH,
                label: "Sammeln",
                reason:
                    `Bestes Sammelziel wäre ${nearestTarget.label} ` +
                    `(${nearestTarget.utility?.scorePercent ?? "?"}% Utility).`
            });
        }

        if (bestPatrolRegion) {
            options.push({
                goal: GOAL.PATROL_AREA,
                label: "Region prüfen",
                reason:
                    `Region ${bestPatrolRegion.id} wäre interessant ` +
                    `(${Math.round(bestPatrolRegion.finalScore * 100)}%).`
            });
        }

        if (knownTargetCount === 0 && knownCoverage < this.config.missionCoverageThreshold) {
            options.push({
                goal: GOAL.EXPLORE,
                label: "Erkunden",
                reason:
                    `Welt erst zu ${Math.round(knownCoverage * 100)}% bekannt.`
            });
        }

        if (home && !atHome && knownTargetCount === 0) {
            options.push({
                goal: GOAL.RETURN_HOME,
                label: "Zur Basis",
                reason: "Kein Ziel bekannt, Basis ist bekannt."
            });
        }

        return options;
    }

    _filterSuppressed(options, activeGoal) {
        return options.filter(option => option.goal !== activeGoal);
    }

    _explainActiveDecision({ activeGoal, title, summary, priority, evidence = [], suppressedGoals = [] }) {
        return {
            activeGoal,
            title,
            summary,
            priority,
            evidence,
            suppressedGoals
        };
    }

    _updateMissionMemory(knownTargetCount) {
        if (knownTargetCount > 0) {
            this.ticksWithoutKnownTrash = 0;
        } else {
            this.ticksWithoutKnownTrash++;
        }
    }

    _missionLooksComplete(knownCoverage, knownTargetCount) {
        if (knownTargetCount > 0) return false;

        if (knownCoverage >= this.config.missionCoverageThreshold) {
            return true;
        }

        if (this.ticksWithoutKnownTrash >= this.config.maxTicksWithoutKnownTrash) {
            return true;
        }

        return false;
    }

    _hasEnergyForMission(position, target, home, body) {
        if (!home) {
            return body.batteryRatio > 0.55;
        }

        const distanceToTarget = manhattan(position, target);
        const distanceTargetToHome = manhattan(target, home);

        const estimatedMissionCost =
            (distanceToTarget + distanceTargetToHome) *
            this.config.moveCostEstimate +
            this.config.reserveBattery;

        return body.battery >= estimatedMissionCost;
    }
}