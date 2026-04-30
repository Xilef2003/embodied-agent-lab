import { GOAL } from "../config.js";
import { manhattan } from "../utils/Grid.js";

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

            // v1.5: Target Commitment
            // Ein neues Ziel muss deutlich besser sein, bevor der Agent sein aktuelles Sammelziel wechselt.
            targetSwitchAdvantage: 0.25,

            // Falls das committed Ziel unter diese Utility fällt, darf es aufgegeben werden.
            targetCommitMinUtility: 0.12,

            // Falls das Ziel zu riskant wird, wird es aufgegeben.
            targetCommitMaxRiskPenalty: 0.55,

            // v1.5: Return Budget
            // Wenn der Agent nach Rückkehr zur Basis weniger als diese Reserve hätte,
            // fährt er frühzeitig zurück.
            returnReserveBattery: 12,

            // Zusätzlicher Trigger bei teilgefülltem Behälter.
            partialLoadReturnRatio: 0.34,

            // Falls NeedSystem bereits Rückwegrisiko meldet.
            returnRiskThresholdForPartialReturn: 0.22,

            ...options
        };

        this.committedGoal = null;
        this.committedSafetyTargetId = null;

        this.committedCollectTargetId = null;
        this.committedCollectTargetConcept = null;
        this.committedCollectTargetLabel = null;
        this.committedCollectStartedAt = null;

        this.ticksWithoutKnownTrash = 0;
    }

    choose(needs, emotions, robot, worldModel, semantic = null, spatial = null) {
        const body = robot.body;
        const position = robot.position;
        const home = worldModel.home;
        const atHome = Boolean(home && manhattan(position, home) === 0);

        const returnBudget = this._computeReturnBudget(position, home, body, needs);

        const semanticHazards = semantic?.hazards || [];
        const nearestHazard = semanticHazards[0] || null;

        const immediateHazard = semanticHazards.find(
            hazard => hazard.distance <= this.config.safetyTriggerDistance
        );

        const committedHazard = this.committedSafetyTargetId
            ? semanticHazards.find(hazard => hazard.id === this.committedSafetyTargetId)
            : null;

        const collectableTargets = semantic?.collectableTargets || [];

        const actionableTargetsFromUtility =
            semantic?.utility?.actionableTargets ||
            collectableTargets.filter(target =>
                target.utility?.isPhysicallyPossible !== false &&
                target.utility?.score > 0.08
            );

        const viableTargets = actionableTargetsFromUtility.filter(item =>
            item.utility?.isEnergyViable !== false &&
            item.utility?.isPhysicallyPossible !== false &&
            (item.utility?.score ?? 0) >= this.config.minUtilityToStartMission
        );

        const bestUtilityTarget = viableTargets[0] || null;
        const bestObservedTarget = collectableTargets[0] || null;
        const committedTarget = this._getCommittedCollectTarget(viableTargets);

        const fallbackNearestTrash = !semantic
            ? worldModel.getNearestKnownTrash(position)
            : null;

        const actionableTargetCount = viableTargets.length;
        const knownTargetCount = collectableTargets.length;

        const bestPatrolRegion = spatial?.bestPatrolRegion || null;
        const knownCoverage = worldModel.getKnownCellRatio();

        this._updateMissionMemory(actionableTargetCount);

        const suppressedBase = this._makeSuppressedOptions({
            body,
            atHome,
            bestUtilityTarget,
            bestObservedTarget,
            committedTarget,
            home,
            actionableTargetCount,
            knownTargetCount,
            knownCoverage,
            needs,
            bestPatrolRegion,
            returnBudget
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
                            `Safety-Release-Distanz: ${this.config.safetyReleaseDistance}`,
                            this._commitmentEvidenceLine()
                        ].filter(Boolean),
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
                        `Safety-Trigger-Distanz: ${this.config.safetyTriggerDistance}`,
                        this._commitmentEvidenceLine()
                    ].filter(Boolean),
                    suppressedGoals: suppressedBase
                })
            };
        }

        // 3. Entladen bleibt aktiv, bis der Behälter leer ist.
        if (this.committedGoal === GOAL.EMPTY_LOAD) {
            if (body.trashLoad > 0) {
                this._clearCollectCommit();

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
                            `Home bekannt: ${home ? "ja" : "nein"}`,
                            this._formatReturnBudget(returnBudget)
                        ].filter(Boolean),
                        suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.EMPTY_LOAD)
                    })
                };
            }

            this.committedGoal = null;
        }

        if (body.isLoadFull) {
            this.committedGoal = GOAL.EMPTY_LOAD;
            this._clearCollectCommit();

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
                        `Bestes mögliches Sammelziel wäre: ${bestUtilityTarget?.label || "-"}`,
                        `Bestes beobachtetes Objekt wäre: ${bestObservedTarget?.label || "-"}`,
                        this._formatReturnBudget(returnBudget)
                    ].filter(Boolean),
                    suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.EMPTY_LOAD)
                })
            };
        }

        if (atHome && body.trashLoad > 0) {
            this.committedGoal = GOAL.EMPTY_LOAD;
            this._clearCollectCommit();

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
                this._clearCollectCommit();

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
            this._clearCollectCommit();

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
                        `Return Risk: ${needs.returnRisk.toFixed(2)}`,
                        this._formatReturnBudget(returnBudget)
                    ].filter(Boolean),
                    suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.CHARGE)
                })
            };
        }

        if (atHome && body.batteryRatio < this.config.leaveBaseMinBatteryRatio) {
            this.committedGoal = GOAL.CHARGE;
            this._clearCollectCommit();

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
            this._clearCollectCommit();

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
                        "Home bekannt: ja",
                        this._formatReturnBudget(returnBudget)
                    ].filter(Boolean),
                    suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.CHARGE)
                })
            };
        }

        // 5. v1.5: Frühzeitige Rückkehr bei knappem Rückkehrbudget.
        if (this._shouldReturnEarly(body, atHome, home, returnBudget, needs)) {
            this.committedGoal = GOAL.EMPTY_LOAD;
            this._clearCollectCommit();

            return {
                type: GOAL.EMPTY_LOAD,
                priority: 0.91,
                reason:
                    "Frühzeitige Rückkehr: Rückkehrbudget wird knapp, obwohl der Behälter noch nicht voll ist.",
                explanation: this._explainActiveDecision({
                    activeGoal: GOAL.EMPTY_LOAD,
                    title: "Aktive Entscheidung: Frühzeitig zurückkehren",
                    summary:
                        "Der Agent trägt bereits Müll und die berechnete Akku-Reserve nach Rückkehr " +
                        "zur Basis wird zu klein. Er fährt jetzt zurück, statt weiter zu sammeln.",
                    priority: "return_budget",
                    evidence: [
                        `Müllbehälter: ${body.trashLoad}/${body.maxTrashLoad}`,
                        `Akku: ${Math.round(body.battery)}%`,
                        this._formatReturnBudget(returnBudget),
                        `Mindestreserve: ${this.config.returnReserveBattery}%`,
                        `Return Risk: ${needs.returnRisk.toFixed(2)}`
                    ].filter(Boolean),
                    suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.EMPTY_LOAD)
                })
            };
        }

        // 6. v1.5: Target Commitment.
        const collectDecision = this._chooseCommittedCollectTarget({
            committedTarget,
            bestUtilityTarget,
            viableTargets,
            fallbackNearestTrash
        });

        if (
            collectDecision.target &&
            collectDecision.target.entity &&
            actionableTargetCount > 0 &&
            !body.isLoadFull &&
            this._hasEnergyForMission(position, collectDecision.target.entity, home, body)
        ) {
            this.committedGoal = null;
            this._setCollectCommit(collectDecision.target);

            return this._makeCollectGoal({
                target: collectDecision.target,
                mode: collectDecision.mode,
                switchInfo: collectDecision.switchInfo,
                suppressedBase,
                returnBudget
            });
        }

        // 7. Wenn nur ungeeigneter Müll bekannt ist, nicht sinnlos laden.
        if (!bestUtilityTarget && bestObservedTarget && knownTargetCount > 0) {
            this.committedGoal = null;
            this._clearCollectCommit();

            if (
                bestPatrolRegion &&
                bestPatrolRegion.finalScore >= this.config.minPatrolScore &&
                body.batteryRatio > 0.35 &&
                !body.isLoadFull
            ) {
                return this._makePatrolGoal(bestPatrolRegion, suppressedBase);
            }

            return {
                type: GOAL.EXPLORE,
                priority: 0.5,
                reason:
                    `Bekannte Müllobjekte sind aktuell nicht sinnvoll greifbar. ` +
                    `Erkunde weiter statt unmögliche Objekte erneut zu versuchen.`,
                explanation: this._explainActiveDecision({
                    activeGoal: GOAL.EXPLORE,
                    title: "Aktive Entscheidung: Weiter erkunden",
                    summary:
                        "Es gibt bekannte Müllobjekte, aber sie sind aufgrund von Utility, Energie " +
                        "oder physischen Grenzen aktuell keine guten Ziele.",
                    priority: "curiosity",
                    evidence: [
                        `Bestes beobachtetes Objekt: ${bestObservedTarget.label}`,
                        `Utility: ${bestObservedTarget.utility?.scorePercent ?? "?"}%`,
                        `Physisch machbar: ${bestObservedTarget.utility?.isPhysicallyPossible ? "ja" : "nein"}`
                    ],
                    suppressedGoals: suppressedBase
                })
            };
        }

        // 8. Patrouille zu interessanter Region.
        if (
            bestPatrolRegion &&
            bestPatrolRegion.finalScore >= this.config.minPatrolScore &&
            body.batteryRatio > 0.35 &&
            !body.isLoadFull
        ) {
            this.committedGoal = null;
            this._clearCollectCommit();

            return this._makePatrolGoal(bestPatrolRegion, suppressedBase);
        }

        // 9. Missionsabschluss auf Basis handlungsfähiger Ziele.
        const missionLooksComplete = this._missionLooksComplete(knownCoverage, actionableTargetCount);

        if (missionLooksComplete && actionableTargetCount === 0) {
            this.committedGoal = null;
            this._clearCollectCommit();

            if (atHome) {
                return {
                    type: GOAL.STANDBY,
                    priority: 0.7,
                    reason:
                        "Mission wirkt abgeschlossen: kein machbares sammelbares Ziel " +
                        "und Basis erreicht.",
                    explanation: this._explainActiveDecision({
                        activeGoal: GOAL.STANDBY,
                        title: "Aktive Entscheidung: Standby",
                        summary:
                            "Der Agent kennt kein aktuell machbares Ziel mehr und befindet sich an der Basis.",
                        priority: "mission_complete",
                        evidence: [
                            `Bekannte Welt: ${Math.round(knownCoverage * 100)}%`,
                            `Machbare Sammelziele: ${actionableTargetCount}`,
                            `Bekannte Sammelobjekte: ${knownTargetCount}`
                        ],
                        suppressedGoals: []
                    })
                };
            }

            if (home) {
                return {
                    type: GOAL.RETURN_HOME,
                    priority: 0.76,
                    reason: "Kein machbares sammelbares Ziel mehr. Kehre zur Basis zurück.",
                    explanation: this._explainActiveDecision({
                        activeGoal: GOAL.RETURN_HOME,
                        title: "Aktive Entscheidung: Mission abschließen",
                        summary:
                            "Der Agent findet keine machbaren Sammelziele mehr und kehrt zur Basis zurück.",
                        priority: "mission_complete",
                        evidence: [
                            `Bekannte Welt: ${Math.round(knownCoverage * 100)}%`,
                            `Machbare Sammelziele: ${actionableTargetCount}`,
                            `Bekannte Sammelobjekte: ${knownTargetCount}`
                        ],
                        suppressedGoals: []
                    })
                };
            }
        }

        // 10. Standard: erkunden.
        this.committedGoal = null;
        this._clearCollectCommit();

        return {
            type: GOAL.EXPLORE,
            priority: 0.45 + emotions.curiosity * 0.3,
            reason: "Unbekannte Weltbereiche erkunden.",
            explanation: this._explainActiveDecision({
                activeGoal: GOAL.EXPLORE,
                title: "Aktive Entscheidung: Erkunden",
                summary:
                    "Kein dringendes Körperziel, kein gutes machbares Sammelziel und keine starke " +
                    "Patrouillenregion aktiv. Der Agent erweitert sein Weltmodell.",
                priority: "curiosity",
                evidence: [
                    `Curiosity: ${emotions.curiosity.toFixed(2)}`,
                    `Bekannte Welt: ${Math.round(knownCoverage * 100)}%`,
                    `Machbare Sammelziele: ${actionableTargetCount}`,
                    `Bekannte Sammelobjekte: ${knownTargetCount}`
                ],
                suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.EXPLORE)
            })
        };
    }

    _chooseCommittedCollectTarget({ committedTarget, bestUtilityTarget }) {
        if (!bestUtilityTarget) {
            this._clearCollectCommit();

            return {
                target: null,
                mode: "none",
                switchInfo: null
            };
        }

        if (!committedTarget) {
            return {
                target: bestUtilityTarget,
                mode: "new",
                switchInfo: null
            };
        }

        const committedScore = committedTarget.utility?.score ?? 0;
        const bestScore = bestUtilityTarget.utility?.score ?? 0;
        const sameTarget = this._targetId(committedTarget) === this._targetId(bestUtilityTarget);

        const committedStillValid =
            committedTarget.utility?.isPhysicallyPossible !== false &&
            committedTarget.utility?.isEnergyViable !== false &&
            committedScore >= this.config.targetCommitMinUtility &&
            (committedTarget.utility?.riskPenalty ?? 0) <= this.config.targetCommitMaxRiskPenalty;

        if (!committedStillValid) {
            this._clearCollectCommit();

            return {
                target: bestUtilityTarget,
                mode: "commitment_broken",
                switchInfo: {
                    previousLabel: committedTarget.label,
                    previousScore,
                    newLabel: bestUtilityTarget.label,
                    newScore: bestScore
                }
            };
        }

        if (!sameTarget) {
            const advantage = bestScore - committedScore;

            if (advantage >= this.config.targetSwitchAdvantage) {
                return {
                    target: bestUtilityTarget,
                    mode: "switched",
                    switchInfo: {
                        previousLabel: committedTarget.label,
                        previousScore: committedScore,
                        newLabel: bestUtilityTarget.label,
                        newScore: bestScore,
                        advantage
                    }
                };
            }
        }

        return {
            target: committedTarget,
            mode: "committed",
            switchInfo: bestUtilityTarget && !sameTarget
                ? {
                    previousLabel: committedTarget.label,
                    previousScore: committedScore,
                    newLabel: bestUtilityTarget.label,
                    newScore: bestScore,
                    advantage: bestScore - committedScore,
                    requiredAdvantage: this.config.targetSwitchAdvantage
                }
                : null
        };
    }

    _makeCollectGoal({ target, mode, switchInfo, suppressedBase, returnBudget }) {
        const utility = target.utility;
        const score = utility ? `${utility.scorePercent}%` : "unbekannt";

        const modeText = {
            new: "Bestes Sammelziel nach Utility",
            committed: "Sammelziel wird durch Zielbindung beibehalten",
            switched: "Sammelziel gewechselt, weil neues Ziel deutlich besser ist",
            commitment_broken: "Altes Sammelziel aufgegeben, neues Ziel gewählt"
        }[mode] || "Sammelziel gewählt";

        const evidence = [
            `Utility: ${score}`,
            `Konzept: ${target.concept}`,
            `Distanz: ${utility?.distanceToTarget ?? "?"}`,
            `Akku reicht: ${utility?.isEnergyViable ? "ja" : "nein"}`,
            `Physisch machbar: ${utility?.isPhysicallyPossible ? "ja" : "nein"}`,
            `Zielbindung: ${mode === "committed" ? "aktiv" : "neu gesetzt"}`,
            this._formatReturnBudget(returnBudget)
        ].filter(Boolean);

        if (switchInfo && mode === "committed") {
            evidence.push(
                `Nicht gewechselt: ${switchInfo.newLabel} wäre nur ` +
                `${Math.round((switchInfo.advantage || 0) * 100)} Punkte besser; nötig wären ` +
                `${Math.round((switchInfo.requiredAdvantage || 0) * 100)}.`
            );
        }

        if (switchInfo && mode === "switched") {
            evidence.push(
                `Zielwechsel: ${switchInfo.newLabel} ist ` +
                `${Math.round((switchInfo.advantage || 0) * 100)} Punkte besser als ` +
                `${switchInfo.previousLabel}.`
            );
        }

        if (switchInfo && mode === "commitment_broken") {
            evidence.push(
                `Altes Ziel aufgegeben: ${switchInfo.previousLabel} ist nicht mehr sinnvoll.`
            );
        }

        return {
            type: GOAL.COLLECT_TRASH,
            priority: 0.78,
            targetId: target.entity.id,
            targetConcept: target.concept,
            targetLabel: target.label,
            utilityScore: utility?.score ?? null,
            reason:
                `${modeText}: ${target.label} (${score}). ` +
                `${utility?.explanation || ""}`,
            explanation: this._explainActiveDecision({
                activeGoal: GOAL.COLLECT_TRASH,
                title:
                    mode === "committed"
                        ? "Aktive Entscheidung: Sammeln fortsetzen"
                        : "Aktive Entscheidung: Sammeln",
                summary:
                    mode === "committed"
                        ? `${target.label} bleibt das aktive Sammelziel. Der Agent vermeidet unnötiges Umschalten.`
                        : `${target.label} wurde als bestes machbares Sammelziel gewählt.`,
                priority: "mission",
                evidence,
                suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.COLLECT_TRASH)
            })
        };
    }

    _makePatrolGoal(bestPatrolRegion, suppressedBase) {
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
                    `Müll gesehen: ${bestPatrolRegion.uniqueTrashSeen ?? bestPatrolRegion.trashSeen ?? 0}`,
                    `Müll-Beobachtungen: ${bestPatrolRegion.trashObservations ?? 0}`,
                    `Müll gesammelt: ${bestPatrolRegion.trashCollected}`,
                    `Risiken gesehen: ${bestPatrolRegion.uniqueHazardSeen ?? bestPatrolRegion.hazardSeen ?? 0}`,
                    `Risiko-Beobachtungen: ${bestPatrolRegion.hazardObservations ?? 0}`,
                    `Risiko: ${bestPatrolRegion.riskPercent}%`,
                    `Zusammenfassung: ${bestPatrolRegion.summary}`
                ],
                suppressedGoals: this._filterSuppressed(suppressedBase, GOAL.PATROL_AREA)
            })
        };
    }

    _makeSuppressedOptions({
        body,
        atHome,
        bestUtilityTarget,
        bestObservedTarget,
        committedTarget,
        home,
        actionableTargetCount,
        knownTargetCount,
        knownCoverage,
        needs,
        bestPatrolRegion,
        returnBudget
    }) {
        const options = [];

        if (body.trashLoad > 0 || body.isLoadFull) {
            const reasonParts = [];

            reasonParts.push(
                body.isLoadFull
                    ? "Behälter ist voll."
                    : "Es befindet sich Müll im Behälter."
            );

            if (returnBudget && !atHome && home) {
                reasonParts.push(
                    `Rückkehrreserve: ${Math.round(returnBudget.margin)}%.`
                );
            }

            options.push({
                goal: GOAL.EMPTY_LOAD,
                label: "Entladen",
                reason: reasonParts.join(" ")
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

        if (committedTarget) {
            options.push({
                goal: GOAL.COLLECT_TRASH,
                label: "Committed Sammelziel",
                reason:
                    `${committedTarget.label} ist als Ziel gebunden ` +
                    `(${committedTarget.utility?.scorePercent ?? "?"}% Utility).`
            });
        } else if (bestUtilityTarget) {
            options.push({
                goal: GOAL.COLLECT_TRASH,
                label: "Sammeln",
                reason:
                    `Bestes machbares Sammelziel wäre ${bestUtilityTarget.label} ` +
                    `(${bestUtilityTarget.utility?.scorePercent ?? "?"}% Utility).`
            });
        } else if (bestObservedTarget) {
            options.push({
                goal: GOAL.COLLECT_TRASH,
                label: "Sammeln blockiert",
                reason:
                    `${bestObservedTarget.label} ist bekannt, aber aktuell nicht sinnvoll greifbar ` +
                    `(${bestObservedTarget.utility?.scorePercent ?? "?"}% Utility; ` +
                    `physisch machbar: ${bestObservedTarget.utility?.isPhysicallyPossible ? "ja" : "nein"}).`
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

        if (actionableTargetCount === 0 && knownCoverage < this.config.missionCoverageThreshold) {
            options.push({
                goal: GOAL.EXPLORE,
                label: "Erkunden",
                reason:
                    `Welt erst zu ${Math.round(knownCoverage * 100)}% bekannt. ` +
                    `Bekannte Sammelobjekte: ${knownTargetCount}.`
            });
        }

        if (home && !atHome && actionableTargetCount === 0) {
            options.push({
                goal: GOAL.RETURN_HOME,
                label: "Zur Basis",
                reason: "Kein machbares Ziel bekannt, Basis ist bekannt."
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

    _updateMissionMemory(actionableTargetCount) {
        if (actionableTargetCount > 0) {
            this.ticksWithoutKnownTrash = 0;
        } else {
            this.ticksWithoutKnownTrash++;
        }
    }

    _missionLooksComplete(knownCoverage, actionableTargetCount) {
        if (actionableTargetCount > 0) return false;

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

    _computeReturnBudget(position, home, body, needs) {
        if (!home) {
            return null;
        }

        const distanceHome = manhattan(position, home);

        const estimatedReturnCost =
            distanceHome * this.config.moveCostEstimate +
            this.config.reserveBattery;

        const margin = body.battery - estimatedReturnCost;

        return {
            distanceHome,
            estimatedReturnCost,
            margin,
            isLow: margin <= this.config.returnReserveBattery,
            returnRisk: needs?.returnRisk ?? 0
        };
    }

    _shouldReturnEarly(body, atHome, home, returnBudget, needs) {
        if (!home || atHome) return false;
        if (body.trashLoad <= 0) return false;
        if (!returnBudget) return false;

        if (returnBudget.margin <= this.config.returnReserveBattery) {
            return true;
        }

        if (
            body.loadRatio >= this.config.partialLoadReturnRatio &&
            returnBudget.margin <= this.config.returnReserveBattery + 6
        ) {
            return true;
        }

        if (needs.returnRisk >= this.config.returnRiskThresholdForPartialReturn) {
            return true;
        }

        return false;
    }

    _formatReturnBudget(returnBudget) {
        if (!returnBudget) return null;

        return (
            `Rückkehrbudget: Distanz Basis ${returnBudget.distanceHome}, ` +
            `Kosten ca. ${Math.round(returnBudget.estimatedReturnCost)}%, ` +
            `Reserve danach ca. ${Math.round(returnBudget.margin)}%.`
        );
    }

    _setCollectCommit(target) {
        if (!target?.entity?.id) return;

        this.committedCollectTargetId = target.entity.id;
        this.committedCollectTargetConcept = target.concept;
        this.committedCollectTargetLabel = target.label;

        if (this.committedCollectStartedAt === null) {
            this.committedCollectStartedAt = Date.now();
        }
    }

    _clearCollectCommit() {
        this.committedCollectTargetId = null;
        this.committedCollectTargetConcept = null;
        this.committedCollectTargetLabel = null;
        this.committedCollectStartedAt = null;
    }

    _getCommittedCollectTarget(targets) {
        if (!this.committedCollectTargetId) return null;

        const target = targets.find(item =>
            this._targetId(item) === this.committedCollectTargetId
        );

        if (!target) {
            this._clearCollectCommit();
            return null;
        }

        return target;
    }

    _targetId(target) {
        return target?.entity?.id || target?.id || null;
    }

    _commitmentEvidenceLine() {
        if (!this.committedCollectTargetId) return null;

        return (
            `Sammelziel im Gedächtnis: ${this.committedCollectTargetLabel || this.committedCollectTargetId}` +
            `${this.committedCollectTargetConcept ? ` (${this.committedCollectTargetConcept})` : ""}.`
        );
    }
}