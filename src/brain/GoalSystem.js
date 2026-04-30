import { GOAL } from "../config.js";
import { manhattan } from "../utils/Grid.js";

/**
 * GoalSystem v0.3
 *
 * Wichtigste Änderung:
 * v0.2 konnte zu früh von der Ladestation losfahren:
 *
 *   laden -> ein Schritt Richtung Müll -> sofort wieder zurück -> laden -> ...
 *
 * Das war kein Pathfinding-Fehler, sondern ein Zielwechsel-Fehler.
 * Deshalb gibt es jetzt Goal-Commitment:
 *
 * - Wenn CHARGE aktiv ist, bleibt der Roboter beim Laden,
 *   bis der Akku ausreichend voll ist.
 * - Wenn EMPTY_LOAD aktiv ist, bleibt der Roboter beim Entladen,
 *   bis der Behälter leer ist.
 * - Eine Müllmission wird nur gestartet, wenn genug Energie für
 *   Hinweg + Rückweg + Sicherheitsreserve vorhanden ist.
 */
export class GoalSystem {
    constructor(options = {}) {
        this.config = {
            chargeUntilRatio: 0.82,
            leaveBaseMinBatteryRatio: 0.55,
            reserveBattery: 14,
            moveCostEstimate: 0.7,
            ...options
        };

        this.committedGoal = null;
    }

    choose(needs, emotions, robot, worldModel) {
        const body = robot.body;
        const position = robot.position;
        const home = worldModel.home;
        const atHome = Boolean(home && manhattan(position, home) === 0);
        const hazards = worldModel.getKnownHazards(position, 1);

        // Sicherheit darf jedes andere Ziel überschreiben.
        if (hazards.length > 0 && emotions.caution > 0.35) {
            this.committedGoal = null;

            return {
                type: GOAL.AVOID,
                priority: 0.98,
                reason: "Direktes Risiko in der Nähe."
            };
        }

        // Wenn der Roboter voll ist, muss er zur Basis.
        // Dieses Ziel bleibt aktiv, bis der Behälter leer ist.
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

        // Wenn der Roboter zufällig an der Basis ist und Müll geladen hat,
        // soll er entladen, auch wenn der Behälter nicht voll ist.
        if (atHome && body.trashLoad > 0) {
            this.committedGoal = GOAL.EMPTY_LOAD;

            return {
                type: GOAL.EMPTY_LOAD,
                priority: 0.88,
                reason: "An der Basis: gesammelten Müll abgeben."
            };
        }

        // CHARGE-Commitment:
        // Wenn Laden aktiv ist, bleibt es aktiv, bis der Akku wieder sinnvoll voll ist.
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

        // Kritischer Akku oder Rückwegrisiko: sofort laden.
        if (body.isBatteryCritical || needs.returnRisk > 0.35) {
            this.committedGoal = GOAL.CHARGE;

            return {
                type: GOAL.CHARGE,
                priority: 1,
                reason: "Akku kritisch oder Rückweg gefährdet."
            };
        }

        // Wenn der Roboter an der Basis ist, soll er nicht mit halb leerem Akku
        // sofort wieder losfahren. Erst sinnvoll aufladen.
        if (atHome && body.batteryRatio < this.config.leaveBaseMinBatteryRatio) {
            this.committedGoal = GOAL.CHARGE;

            return {
                type: GOAL.CHARGE,
                priority: 0.92,
                reason: `An Basis: vor neuer Mission mindestens ${Math.round(this.config.leaveBaseMinBatteryRatio * 100)}% Akku laden.`
            };
        }

        // Niedriger Akku unterwegs: zurück zur Ladestation.
        if (body.isBatteryLow && home) {
            this.committedGoal = GOAL.CHARGE;

            return {
                type: GOAL.CHARGE,
                priority: 0.9,
                reason: "Akku niedrig, Rückkehr zur Ladestation priorisiert."
            };
        }

        const knownTrash = worldModel.getKnownTrash();
        const nearestTrash = worldModel.getNearestKnownTrash(position);

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

        // Wenn Müll bekannt ist, aber die Energie für die Mission nicht reicht,
        // wird erst geladen statt halb loszufahren.
        if (nearestTrash && home && !this._hasEnergyForTrashMission(position, nearestTrash, home, body)) {
            this.committedGoal = GOAL.CHARGE;

            return {
                type: GOAL.CHARGE,
                priority: 0.87,
                reason: "Müll bekannt, aber Energiebudget für sichere Mission reicht nicht."
            };
        }

        this.committedGoal = null;

        return {
            type: GOAL.EXPLORE,
            priority: 0.45 + emotions.curiosity * 0.3,
            reason: "Unbekannte Weltbereiche erkunden."
        };
    }

    _hasEnergyForTrashMission(position, trash, home, body) {
        if (!home) {
            return body.batteryRatio > 0.55;
        }

        const distanceToTrash = manhattan(position, trash);
        const distanceTrashToHome = manhattan(trash, home);

        const estimatedMissionCost =
            (distanceToTrash + distanceTrashToHome) * this.config.moveCostEstimate +
            this.config.reserveBattery;

        return body.battery >= estimatedMissionCost;
    }
}
