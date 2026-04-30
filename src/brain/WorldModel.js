import { ENTITY } from "../config.js";
import { keyOf, manhattan, neighbors4, parseKey } from "../utils/Grid.js";

export class WorldModel {
    constructor(width, height) {
        this.width = width;
        this.height = height;

        this.knownCells = new Map();
        this.knownEntities = new Map();
        this.collectedEntities = new Set();
        this.blockedCells = new Set();

        this.home = null;
        this.step = 0;
    }

    update(observation) {
        this.step = observation.step;

        const visibleKeys = new Set();

        for (const cell of observation.visibleCells) {
            const key = keyOf(cell.x, cell.y);
            visibleKeys.add(key);

            this.knownCells.set(key, {
                x: cell.x,
                y: cell.y,
                blocked: cell.blocked,
                entityTypes: [...cell.entityTypes],
                lastSeen: observation.step
            });

            if (cell.blocked) {
                this.blockedCells.add(key);
            } else {
                this.blockedCells.delete(key);
            }
        }

        for (const [id, entity] of [...this.knownEntities.entries()]) {
            const cellKey = keyOf(entity.x, entity.y);

            if (entity.type === ENTITY.TRASH && visibleKeys.has(cellKey)) {
                const visibleCell = this.knownCells.get(cellKey);
                if (!visibleCell?.entityTypes.includes(ENTITY.TRASH)) {
                    this.knownEntities.delete(id);
                }
            }
        }

        for (const entity of observation.visibleEntities) {
            if (this.collectedEntities.has(entity.id)) continue;

            this.knownEntities.set(entity.id, {
                ...entity,
                lastSeen: observation.step
            });

            if (entity.type === ENTITY.CHARGER) {
                this.home = { x: entity.x, y: entity.y, id: entity.id };
            }
        }
    }

    integrateActionResult(action, result) {
        if (!result) return;

        if (result.blockedCell) {
            this.blockedCells.add(keyOf(result.blockedCell.x, result.blockedCell.y));
        }

        if (result.ok && result.type === "pickup" && result.target) {
            this.collectedEntities.add(result.target.id);
            this.knownEntities.delete(result.target.id);
        }
    }

    getKnownTrash() {
        return [...this.knownEntities.values()]
            .filter(entity => entity.type === ENTITY.TRASH)
            .filter(entity => !this.collectedEntities.has(entity.id));
    }

    getNearestKnownTrash(position) {
        return this.getKnownTrash()
            .sort((a, b) => manhattan(position, a) - manhattan(position, b))[0] || null;
    }

    getKnownHazards(position, maxDistance = 2) {
        return [...this.knownEntities.values()]
            .filter(entity => entity.type === ENTITY.HUMAN || entity.type === ENTITY.ANIMAL)
            .filter(entity => manhattan(position, entity) <= maxDistance)
            .sort((a, b) => manhattan(position, a) - manhattan(position, b));
    }

    getKnownCellRatio() {
        return this.knownCells.size / (this.width * this.height);
    }

    isKnownBlocked(x, y) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
        return this.blockedCells.has(keyOf(x, y));
    }

    isKnown(x, y) {
        return this.knownCells.has(keyOf(x, y));
    }

    getExplorationTarget(position) {
        const frontiers = [];

        for (const [, cell] of this.knownCells.entries()) {
            if (this.isKnownBlocked(cell.x, cell.y)) continue;

            const unknownNeighbor = neighbors4(cell.x, cell.y)
                .find(n =>
                    n.x >= 0 &&
                    n.y >= 0 &&
                    n.x < this.width &&
                    n.y < this.height &&
                    !this.isKnown(n.x, n.y)
                );

            if (unknownNeighbor) {
                frontiers.push({
                    ...cell,
                    unknownNeighbor,
                    distance: manhattan(position, cell)
                });
            }
        }

        if (frontiers.length > 0) {
            frontiers.sort((a, b) => a.distance - b.distance);
            return frontiers[0];
        }

        const known = [...this.knownCells.values()]
            .filter(cell => !this.isKnownBlocked(cell.x, cell.y))
            .sort((a, b) => a.lastSeen - b.lastSeen);

        return known[0] || null;
    }

    markCellBlocked(x, y) {
        this.blockedCells.add(keyOf(x, y));
    }

    debugKnownCells() {
        return [...this.knownCells.keys()].map(parseKey);
    }
}
