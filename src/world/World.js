import { CONFIG, ENTITY } from "../config.js";
import { Entity, resetEntityIds } from "./Entity.js";
import { RNG } from "../utils/Random.js";
import { keyOf, neighbors4 } from "../utils/Grid.js";

export class World {
    constructor(config = CONFIG, seed = CONFIG.initialSeed) {
        this.config = config;
        this.seed = seed;
        this.reset(seed);
    }

    reset(seed = this.seed) {
        resetEntityIds();

        this.seed = seed;
        this.rng = new RNG(seed);
        this.width = this.config.gridWidth;
        this.height = this.config.gridHeight;
        this.step = 0;
        this.entities = new Map();

        this.robotStart = { x: 2, y: 2 };

        this.addEntity(ENTITY.CHARGER, this.robotStart.x, this.robotStart.y, {
            label: "Ladestation"
        });

        this._spawnObstacles();
        this._spawnTrash();
        this._spawnActors();

        return this;
    }

    addEntity(type, x, y, props = {}) {
        const entity = new Entity(type, x, y, props);
        this.entities.set(entity.id, entity);
        return entity;
    }

    removeEntity(id) {
        return this.entities.delete(id);
    }

    getEntity(id) {
        return this.entities.get(id) || null;
    }

    findEntities(type) {
        return [...this.entities.values()].filter(entity => entity.type === type);
    }

    entitiesAt(x, y, type = null) {
        return [...this.entities.values()].filter(entity => {
            if (entity.x !== x || entity.y !== y) return false;
            if (type && entity.type !== type) return false;
            return true;
        });
    }

    entityAt(x, y, type = null) {
        return this.entitiesAt(x, y, type)[0] || null;
    }

    isInside(x, y) {
        return x >= 0 && y >= 0 && x < this.width && y < this.height;
    }

    isBlocked(x, y) {
        if (!this.isInside(x, y)) return true;

        return this.entitiesAt(x, y).some(entity =>
            entity.type === ENTITY.OBSTACLE ||
            entity.type === ENTITY.HUMAN ||
            entity.type === ENTITY.ANIMAL
        );
    }

    isEmptyForSpawn(x, y) {
        if (!this.isInside(x, y)) return false;
        if (x === this.robotStart.x && y === this.robotStart.y) return false;
        if (Math.abs(x - this.robotStart.x) + Math.abs(y - this.robotStart.y) < 3) return false;

        return this.entitiesAt(x, y).length === 0;
    }

    getCharger() {
        return this.findEntities(ENTITY.CHARGER)[0] || null;
    }

    randomEmptyCell(maxTries = 2000) {
        for (let i = 0; i < maxTries; i++) {
            const x = this.rng.int(0, this.width - 1);
            const y = this.rng.int(0, this.height - 1);

            if (this.isEmptyForSpawn(x, y)) {
                return { x, y };
            }
        }

        return null;
    }

    tickEnvironment(robotPosition) {
        this.step++;

        for (const animal of this.findEntities(ENTITY.ANIMAL)) {
            if (!this.rng.chance(0.18)) continue;

            const options = neighbors4(animal.x, animal.y)
                .filter(cell => this.isInside(cell.x, cell.y))
                .filter(cell => !this.isBlocked(cell.x, cell.y))
                .filter(cell => !(cell.x === robotPosition.x && cell.y === robotPosition.y))
                .filter(cell => this.entityAt(cell.x, cell.y, ENTITY.TRASH) === null)
                .filter(cell => this.entityAt(cell.x, cell.y, ENTITY.CHARGER) === null);

            if (options.length === 0) continue;

            const next = this.rng.pick(options);
            animal.x = next.x;
            animal.y = next.y;
        }
    }

    _spawnObstacles() {
        for (let i = 0; i < this.config.obstacleCount; i++) {
            const cell = this.randomEmptyCell();
            if (!cell) continue;

            const label = this.rng.chance(0.5) ? "Stein" : "Baum";
            this.addEntity(ENTITY.OBSTACLE, cell.x, cell.y, { label });
        }
    }

    _spawnTrash() {
        const labels = ["Plastikflasche", "Dose", "Papier", "Tüte", "Verpackung"];

        for (let i = 0; i < this.config.trashCount; i++) {
            const cell = this.randomEmptyCell();
            if (!cell) continue;

            this.addEntity(ENTITY.TRASH, cell.x, cell.y, {
                label: this.rng.pick(labels),
                risk: this.rng.chance(0.12) ? "unknown" : "low"
            });
        }
    }

    _spawnActors() {
        for (let i = 0; i < this.config.humanCount; i++) {
            const cell = this.randomEmptyCell();
            if (!cell) continue;
            this.addEntity(ENTITY.HUMAN, cell.x, cell.y, { label: "Mensch" });
        }

        for (let i = 0; i < this.config.animalCount; i++) {
            const cell = this.randomEmptyCell();
            if (!cell) continue;
            this.addEntity(ENTITY.ANIMAL, cell.x, cell.y, { label: "Tier" });
        }
    }

    snapshot() {
        return {
            step: this.step,
            width: this.width,
            height: this.height,
            entities: [...this.entities.values()].map(entity => entity.clonePublic())
        };
    }

    cellKey(x, y) {
        return keyOf(x, y);
    }
}
