import { ACTION, GOAL } from "../config.js";
import { keyOf, manhattan, neighbors4 } from "../utils/Grid.js";

/**
 * Planner v0.2
 *
 * Wichtigste Änderung gegenüber v0.1:
 * - kein rein gieriges "immer einen Schritt Richtung Ziel" mehr
 * - stattdessen BFS-Pfadsuche über das bekannte Weltmodell
 * - Anti-Ping-Pong-Logik gegen Pendeln zwischen zwei Feldern
 * - wenn kein Pfad bekannt ist: explorativ in Richtung Ziel scannen/bewegen
 */
export class Planner {
    constructor() {
        this.lastAction = null;
        this.lastGoal = null;
        this.recentPositions = [];
    }

    plan(goal, worldModel, robot, observation, emotions) {
        this._rememberPosition(robot);
        this.lastGoal = goal;

        let action;

        switch (goal.type) {
            case GOAL.CHARGE:
                action = this._planCharge(worldModel, robot);
                break;

            case GOAL.EMPTY_LOAD:
                action = this._planEmptyLoad(worldModel, robot);
                break;

            case GOAL.COLLECT_TRASH:
                action = this._planCollectTrash(worldModel, robot);
                break;

            case GOAL.AVOID:
                action = this._planAvoid(worldModel, robot);
                break;

            case GOAL.EXPLORE:
            default:
                action = this._planExplore(worldModel, robot, emotions);
                break;
        }

        this.lastAction = action;
        return action;
    }

    _planCharge(worldModel, robot) {
        if (!worldModel.home) {
            return {
                type: ACTION.SCAN,
                reason: "Ladestation unbekannt, scanne Umgebung."
            };
        }

        if (manhattan(robot, worldModel.home) === 0) {
            return {
                type: ACTION.CHARGE,
                reason: "An Ladestation angekommen."
            };
        }

        return this._moveToward(robot, worldModel.home, worldModel, "Zur Ladestation bewegen.");
    }

    _planEmptyLoad(worldModel, robot) {
        if (!worldModel.home) {
            return {
                type: ACTION.SCAN,
                reason: "Basis unbekannt, scanne Umgebung."
            };
        }

        if (manhattan(robot, worldModel.home) === 0) {
            return {
                type: ACTION.EMPTY,
                reason: "Müllbehälter an Basis leeren."
            };
        }

        return this._moveToward(robot, worldModel.home, worldModel, "Zur Basis zurückkehren.");
    }

    _planCollectTrash(worldModel, robot) {
        const target = worldModel.getNearestKnownTrash(robot.position);

        if (!target) {
            return {
                type: ACTION.SCAN,
                reason: "Kein konkreter Müll bekannt."
            };
        }

        if (manhattan(robot, target) <= 1) {
            return {
                type: ACTION.PICKUP,
                targetId: target.id,
                reason: `${target.label} greifen.`
            };
        }

        return this._moveToward(robot, target, worldModel, `${target.label} ansteuern.`);
    }

    _planAvoid(worldModel, robot) {
        const hazards = worldModel.getKnownHazards(robot.position, 2);

        if (hazards.length === 0) {
            return {
                type: ACTION.SCAN,
                reason: "Risiko nicht mehr sichtbar, scanne neu."
            };
        }

        const hazard = hazards[0];

        const candidates = neighbors4(robot.x, robot.y)
            .filter(cell => this._isUsableCell(cell, worldModel))
            .map(cell => ({
                ...cell,
                distanceFromHazard: manhattan(cell, hazard),
                revisitPenalty: this._recentVisitPenalty(cell)
            }))
            .sort((a, b) => {
                const hazardDiff = b.distanceFromHazard - a.distanceFromHazard;
                if (hazardDiff !== 0) return hazardDiff;
                return a.revisitPenalty - b.revisitPenalty;
            });

        const best = candidates[0];

        if (!best) {
            return {
                type: ACTION.IDLE,
                reason: "Kein sicherer Ausweichschritt bekannt."
            };
        }

        return {
            type: ACTION.MOVE,
            dx: best.x - robot.x,
            dy: best.y - robot.y,
            reason: `Von Risiko ${hazard.label} entfernen.`
        };
    }

    _planExplore(worldModel, robot, emotions) {
        if (emotions?.frustration > 0.75) {
            return {
                type: ACTION.SCAN,
                reason: "Frustration hoch, erst neu orientieren."
            };
        }

        const target = worldModel.getExplorationTarget(robot.position);

        if (!target) {
            return {
                type: ACTION.SCAN,
                reason: "Keine unbekannten Ziele gefunden."
            };
        }

        return this._moveToward(robot, target, worldModel, "Unbekannten Bereich erkunden.");
    }

    _moveToward(robot, target, worldModel, reason) {
        const path = this._findPathBFS(robot.position, target, worldModel);

        if (path.length >= 2) {
            const next = path[1];

            return {
                type: ACTION.MOVE,
                dx: next.x - robot.x,
                dy: next.y - robot.y,
                reason: `${reason} Pfadlänge: ${path.length - 1}.`
            };
        }

        // Kein vollständiger Pfad bekannt.
        // Dann nicht pendeln, sondern den besten lokalen Schritt nehmen.
        const local = this._bestLocalStep(robot, target, worldModel);

        if (local) {
            return {
                type: ACTION.MOVE,
                dx: local.x - robot.x,
                dy: local.y - robot.y,
                reason: `${reason} Kein sicherer Gesamtpfad, lokaler Suchschritt.`
            };
        }

        return {
            type: ACTION.SCAN,
            reason: "Kein Pfad bekannt, scanne zur Neuorientierung."
        };
    }

    _findPathBFS(start, goal, worldModel) {
        const startKey = keyOf(start.x, start.y);
        const goalKey = keyOf(goal.x, goal.y);

        if (startKey === goalKey) {
            return [{ x: start.x, y: start.y }];
        }

        const queue = [{ x: start.x, y: start.y }];
        const cameFrom = new Map();
        const visited = new Set([startKey]);

        cameFrom.set(startKey, null);

        while (queue.length > 0) {
            const current = queue.shift();

            const neighbors = this._orderedNeighbors(current, goal, worldModel);

            for (const next of neighbors) {
                const nextKey = keyOf(next.x, next.y);
                if (visited.has(nextKey)) continue;
                if (!this._isUsableCell(next, worldModel)) continue;

                visited.add(nextKey);
                cameFrom.set(nextKey, current);
                queue.push(next);

                if (nextKey === goalKey) {
                    return this._reconstructPath(cameFrom, next);
                }
            }
        }

        return [];
    }

    _reconstructPath(cameFrom, endCell) {
        const path = [];
        let current = endCell;

        while (current) {
            path.push({ x: current.x, y: current.y });
            current = cameFrom.get(keyOf(current.x, current.y));
        }

        return path.reverse();
    }

    _orderedNeighbors(cell, goal, worldModel) {
        return neighbors4(cell.x, cell.y)
            .filter(next => next.x >= 0 && next.y >= 0 && next.x < worldModel.width && next.y < worldModel.height)
            .map(next => ({
                ...next,
                distance: manhattan(next, goal),
                revisitPenalty: this._recentVisitPenalty(next),
                knownPenalty: worldModel.isKnown(next.x, next.y) ? 0 : 0.35
            }))
            .sort((a, b) => {
                const scoreA = a.distance + a.revisitPenalty + a.knownPenalty;
                const scoreB = b.distance + b.revisitPenalty + b.knownPenalty;
                return scoreA - scoreB;
            });
    }

    _bestLocalStep(robot, target, worldModel) {
        const currentDistance = manhattan(robot, target);

        const candidates = neighbors4(robot.x, robot.y)
            .filter(cell => this._isUsableCell(cell, worldModel))
            .map(cell => {
                const distance = manhattan(cell, target);
                const improvement = currentDistance - distance;
                const revisitPenalty = this._recentVisitPenalty(cell);
                const unknownBonus = worldModel.isKnown(cell.x, cell.y) ? 0 : -0.25;

                return {
                    ...cell,
                    score: distance - improvement * 0.4 + revisitPenalty + unknownBonus
                };
            })
            .sort((a, b) => a.score - b.score);

        return candidates[0] || null;
    }

    _isUsableCell(cell, worldModel) {
        if (cell.x < 0 || cell.y < 0) return false;
        if (cell.x >= worldModel.width || cell.y >= worldModel.height) return false;
        if (worldModel.isKnownBlocked(cell.x, cell.y)) return false;

        return true;
    }

    _rememberPosition(robot) {
        const key = keyOf(robot.x, robot.y);

        this.recentPositions.push(key);

        if (this.recentPositions.length > 10) {
            this.recentPositions.shift();
        }
    }

    _recentVisitPenalty(cell) {
        const key = keyOf(cell.x, cell.y);
        const index = this.recentPositions.lastIndexOf(key);

        if (index === -1) return 0;

        const age = this.recentPositions.length - 1 - index;

        // Direktes Zurücklaufen wird stark bestraft,
        // ältere Besuche nur leicht.
        return Math.max(0, 2.5 - age * 0.35);
    }
}
