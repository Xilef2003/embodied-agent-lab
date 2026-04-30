import { ACTION, GOAL } from "../config.js";
import { keyOf, manhattan, neighbors4 } from "../utils/Grid.js";

/**
 * Planner v1.0
 *
 * Neu:
 * - Safety-Planning berücksichtigt Goal-Commitment.
 * - AVOID maximiert Abstand zu allen nahen Risiken.
 * - COLLECT_TRASH nutzt weiterhin Utility-Ziel aus GoalSystem.
 */
export class Planner {
    constructor() {
        this.lastAction = null;
        this.lastGoal = null;
        this.recentPositions = [];
    }

    plan(goal, worldModel, robot, observation, emotions, semantic = null) {
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
                action = this._planCollectTrash(goal, worldModel, robot, semantic);
                break;

            case GOAL.AVOID:
                action = this._planAvoid(goal, worldModel, robot, semantic);
                break;

            case GOAL.RETURN_HOME:
                action = this._planReturnHome(worldModel, robot);
                break;

            case GOAL.STANDBY:
                action = this._planStandby();
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

    _planReturnHome(worldModel, robot) {
        if (!worldModel.home) {
            return {
                type: ACTION.SCAN,
                reason: "Basis unbekannt, scanne Umgebung."
            };
        }

        if (manhattan(robot, worldModel.home) === 0) {
            return {
                type: ACTION.IDLE,
                reason: "Basis erreicht. Warte auf neues Ziel."
            };
        }

        return this._moveToward(robot, worldModel.home, worldModel, "Mission abgeschlossen, Rückkehr zur Basis.");
    }

    _planStandby() {
        return {
            type: ACTION.IDLE,
            reason: "Standby: Mission abgeschlossen, keine semantisch sammelbaren Ziele."
        };
    }

    _planCollectTrash(goal, worldModel, robot, semantic = null) {
        const semanticTarget =
            semantic?.collectableTargets?.find(item => item.entity.id === goal.targetId) ||
            semantic?.collectableTargets?.[0] ||
            null;

        const target =
            semanticTarget?.entity ||
            (goal.targetId ? worldModel.knownEntities.get(goal.targetId) : null) ||
            worldModel.getNearestKnownTrash(robot.position);

        if (!target) {
            return {
                type: ACTION.SCAN,
                reason: "Kein konkretes sammelbares Ziel bekannt."
            };
        }

        if (manhattan(robot, target) <= 1) {
            const semanticReason = semanticTarget
                ? `${semanticTarget.label} ist '${semanticTarget.concept}' mit Utility ${semanticTarget.utility?.scorePercent ?? "?"}%.`
                : `${target.label} ist als Müll markiert.`;

            return {
                type: ACTION.PICKUP,
                targetId: target.id,
                reason: `${target.label} greifen. ${semanticReason}`
            };
        }

        const reason = semanticTarget
            ? `${target.label} ansteuern. Utility: ${semanticTarget.utility?.explanation || "unbekannt"}.`
            : `${target.label} ansteuern.`;

        return this._moveToward(robot, target, worldModel, reason);
    }

    _planAvoid(goal, worldModel, robot, semantic = null) {
        const safeDistance = goal.safeDistance ?? 3;

        const semanticHazards = semantic?.hazards || [];
        const relevantSemanticHazards = semanticHazards
            .filter(item => item.distance < safeDistance + 1);

        const fallbackHazards = worldModel.getKnownHazards(robot.position, safeDistance + 1)
            .map(entity => ({
                id: entity.id,
                label: entity.label,
                entity,
                distance: manhattan(robot.position, entity),
                concept: entity.type
            }));

        const hazards = relevantSemanticHazards.length > 0
            ? relevantSemanticHazards
            : fallbackHazards;

        if (hazards.length === 0) {
            return {
                type: ACTION.SCAN,
                reason: "Risiko nicht mehr sichtbar, scanne neu."
            };
        }

        const primaryHazard =
            hazards.find(item => item.id === goal.hazardId) ||
            hazards[0];

        const currentMinDistance = this._minDistanceToHazards(robot.position, hazards);

        const candidates = neighbors4(robot.x, robot.y)
            .filter(cell => this._isUsableCell(cell, worldModel))
            .map(cell => {
                const minDistanceToHazards = this._minDistanceToHazards(cell, hazards);
                const distanceToPrimary = manhattan(cell, primaryHazard.entity || primaryHazard);
                const revisitPenalty = this._recentVisitPenalty(cell);
                const improvement = minDistanceToHazards - currentMinDistance;

                return {
                    ...cell,
                    minDistanceToHazards,
                    distanceToPrimary,
                    revisitPenalty,
                    improvement,
                    score:
                        minDistanceToHazards * 3 +
                        distanceToPrimary * 1.2 +
                        improvement * 2 -
                        revisitPenalty
                };
            })
            .sort((a, b) => b.score - a.score);

        const best = candidates[0];

        if (!best) {
            return {
                type: ACTION.IDLE,
                reason: "Kein sicherer Ausweichschritt bekannt."
            };
        }

        const hazardNames = hazards
            .slice(0, 3)
            .map(item => item.label || item.concept || "Risiko")
            .join(", ");

        return {
            type: ACTION.MOVE,
            dx: best.x - robot.x,
            dy: best.y - robot.y,
            reason:
                `Sicherheitsabstand erhöhen. Risiken: ${hazardNames}. ` +
                `Abstand ${currentMinDistance} -> ${best.minDistanceToHazards}.`
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
            .filter(next =>
                next.x >= 0 &&
                next.y >= 0 &&
                next.x < worldModel.width &&
                next.y < worldModel.height
            )
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

    _minDistanceToHazards(position, hazards) {
        if (!hazards || hazards.length === 0) return Infinity;

        return Math.min(
            ...hazards.map(item => manhattan(position, item.entity || item))
        );
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

        return Math.max(0, 2.5 - age * 0.35);
    }
}