import { GOAL } from "../config.js";
import { manhattan } from "../utils/Grid.js";

/**
 * GoalSystem v0.4
 *
 * Neu:
 * - Der Roboter erkundet nicht endlos weiter.
 * - Wenn genug Welt bekannt ist und kein Müll mehr bekannt ist,
 *   kehrt er zur Basis zurück.
 * - An der Basis geht er in Standby.
 * - Wenn später wieder Müll bekannt wird, kann er erneut los.
 */
export class GoalSystem {
    constructor(options = {}) {
        this.config = {
            chargeUntilRatio: 0.82,
            leaveBaseMinBatteryRatio: 0.55,
            reserveBattery: 14,
            moveCostEstimate: 0.7,

            // Ab diesem bekannten Weltanteil darf der Agent sagen:
            // "Ich habe genug abgesucht."
            missionCoverageThreshold: 0.88,

            // Falls lange kein Müll bekannt war, soll er auch ohne 88% Coverage
            // irgendwann zur Basis zurückkehren.
            maxTicksWithoutKnownTrash: 180,

            ...options
        };

        this.committedGoal = null;
        this.ticksWithoutKnownTrash = 0;
    }

    choose(needs, emotions, robot, worldModel) {
        const body = robot.body;
        const position = robot.position;
        const home = worldModel.home;
        const atHome = Boolean(home && manhattan(position, home) === 0);

        const hazards = worldModel.getKnownHazards(position, 1);
        const knownTrash = worldModel.getKnownTrash();
        const nearestTrash = worldModel.getNearestKnownTrash(position);
        const knownCoverage = worldModel.getKnownCellRatio();

        this._updateMissionMemory(knownTrash.length);

        // 1. Sicherheit überschreibt alles.
        if (hazards.length > 0 && emotions.caution > 0.35) {
            this.committedGoal = null;

            return {
                type: GOAL.AVOID,
                priority: 0.98,
                reason: "Direktes Risiko in der Nähe."
            };
        }

        // 2. Entladen bleibt aktiv, bis der Behälter leer ist.
        if (this.committedGoal === GOAL.EMPTY_LOAD) {
            if (body.trashLoad > 0) {
                return {
                    type: GOAL.EMPTY_LOAD,
                    priority: 0.96,
                    reason: "Entlade-Ziel wird beibehalten, bis der Behälter leer ist."
                };
            }

            this.committedGoal = null;
        }

        if (body.isLoadFull) {
            this.committedGoal = GOAL.EMPTY_LOAD;

            return {
                type: GOAL.EMPTY_LOAD,
                priority: 0.96,
                reason: "Müllbehälter ist voll."
            };
        }

        // Wenn er an der Basis ist und Müll geladen hat, zuerst abgeben.
        if (atHome && body.trashLoad > 0) {
            this.committedGoal = GOAL.EMPTY_LOAD;

            return {
                type: GOAL.EMPTY_LOAD,
                priority: 0.88,
                reason: "An der Basis: gesammelten Müll abgeben."
            };
        }

        // 3. Laden bleibt aktiv, bis genug Akku da ist.
        if (this.committedGoal === GOAL.CHARGE) {
            if (!atHome || body.batteryRatio < this.config.chargeUntilRatio) {
                return {
                    type: GOAL.CHARGE,
                    priority: 1,
                    reason: `Lade-Ziel wird beibehalten bis ${Math.round(this.config.chargeUntilRatio * 100)}% Akku.`
                };
            }

            this.committedGoal = null;
        }

        if (body.isBatteryCritical || needs.returnRisk > 0.35) {
            this.committedGoal = GOAL.CHARGE;

            return {
                type: GOAL.CHARGE,
                priority: 1,
                reason: "Akku kritisch oder Rückweg gefährdet."
            };
        }

        // An der Basis nicht mit zu wenig Akku losfahren.
        if (atHome && body.batteryRatio < this.config.leaveBaseMinBatteryRatio) {
            this.committedGoal = GOAL.CHARGE;

            return {
                type: GOAL.CHARGE,
                priority: 0.92,
                reason: `An Basis: vor neuer Mission mindestens ${Math.round(this.config.leaveBaseMinBatteryRatio * 100)}% Akku laden.`
            };
        }

        if (body.isBatteryLow && home) {
            this.committedGoal = GOAL.CHARGE;

            return {
                type: GOAL.CHARGE,
                priority: 0.9,
                reason: "Akku niedrig, Rückkehr zur Ladestation priorisiert."
            };
        }

        // 4. Mission abgeschlossen?
        // Kein bekannter Müll + genug erkundet oder lange nichts gefunden.
        const missionLooksComplete = this._missionLooksComplete(knownCoverage, knownTrash.length);

        if (missionLooksComplete && knownTrash.length === 0) {
            this.committedGoal = null;

            if (atHome) {
                return {
                    type: GOAL.STANDBY,
                    priority: 0.7,
                    reason: "Mission wirkt abgeschlossen: kein bekannter Müll und Basis erreicht."
                };
            }

            if (home) {
                return {
                    type: GOAL.RETURN_HOME,
                    priority: 0.76,
                    reason: "Kein bekannter Müll mehr. Kehre zur Basis zurück."
                };
            }
        }

        // 5. Müll sammeln, aber nur wenn die Energie für Hinweg + Rückweg reicht.
        if (
            nearestTrash &&
            knownTrash.length > 0 &&
            !body.isLoadFull &&
            this._hasEnergyForTrashMission(position, nearestTrash, home, body)
        ) {
            this.committedGoal = null;

            return {
                type: GOAL.COLLECT_TRASH,
                priority: 0.74,
                reason: "Müll bekannt und genug Energie für Hinweg, Rückweg und Reserve vorhanden."
            };
        }

        // Müll ist bekannt, aber Energie reicht nicht sicher.
        if (nearestTrash && home && !this._hasEnergyForTrashMission(position, nearestTrash, home, body)) {
            this.committedGoal = GOAL.CHARGE;

            return {
                type: GOAL.CHARGE,
                priority: 0.87,
                reason: "Müll bekannt, aber Energiebudget für sichere Mission reicht nicht."
            };
        }

        // 6. Standard: erkunden.
        this.committedGoal = null;

        return {
            type: GOAL.EXPLORE,
            priority: 0.45 + emotions.curiosity * 0.3,
            reason: "Unbekannte Weltbereiche erkunden."
        };
    }

    _updateMissionMemory(knownTrashCount) {
        if (knownTrashCount > 0) {
            this.ticksWithoutKnownTrash = 0;
        } else {
            this.ticksWithoutKnownTrash++;
        }
    }

    _missionLooksComplete(knownCoverage, knownTrashCount) {
        if (knownTrashCount > 0) return false;

        if (knownCoverage >= this.config.missionCoverageThreshold) {
            return true;
        }

        if (this.ticksWithoutKnownTrash >= this.config.maxTicksWithoutKnownTrash) {
            return true;
        }

        return false;
    }

    _hasEnergyForTrashMission(position, trash, home, body) {
        if (!home) {
            return body.batteryRatio > 0.55;
        }

        const distanceToTrash = manhattan(position, trash);
        const distanceTrashToHome = manhattan(trash, home);

        const estimatedMissionCost =
            (distanceToTrash + distanceTrashToHome) *
            this.config.moveCostEstimate +
            this.config.reserveBattery;

        return body.battery >= estimatedMissionCost;
    }
}