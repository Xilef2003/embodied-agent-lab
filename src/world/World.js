import { CONFIG, ENTITY } from "../config.js";
import { Entity } from "./Entity.js";
import { RNG } from "../utils/Random.js";
import { keyOf, manhattan, neighbors4 } from "../utils/Grid.js";

export class World {
    constructor(config = CONFIG, seed = CONFIG.initialSeed) {
        this.config = config;
        this.seed = seed;
        this.reset(seed);
    }

    reset(seed = this.seed) {
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
        this._spawnTrash(this.config.trashCount);
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
            const x = this._int(0, this.width - 1);
            const y = this._int(0, this.height - 1);

            if (this.isEmptyForSpawn(x, y)) {
                return { x, y };
            }
        }

        return null;
    }

    tickEnvironment(robot) {
        this.step++;

        const events = [];

        this._moveAnimals(robot);
        events.push(...this._moveHumans(robot));
        events.push(...this._maybeSpawnTrash());

        return events;
    }

    _moveAnimals(robot) {
        for (const animal of this.findEntities(ENTITY.ANIMAL)) {
            if (!this._chance(0.18)) continue;

            const options = neighbors4(animal.x, animal.y)
                .filter(cell => this.isInside(cell.x, cell.y))
                .filter(cell => !this.isBlocked(cell.x, cell.y))
                .filter(cell => !(cell.x === robot.x && cell.y === robot.y))
                .filter(cell => this.entityAt(cell.x, cell.y, ENTITY.TRASH) === null)
                .filter(cell => this.entityAt(cell.x, cell.y, ENTITY.CHARGER) === null);

            if (options.length === 0) continue;

            const next = this._pick(options);
            animal.x = next.x;
            animal.y = next.y;
        }
    }

    _moveHumans(robot) {
        const events = [];

        for (const human of this.findEntities(ENTITY.HUMAN)) {
            const distance = manhattan(human, robot);
            const behavior = human.props?.behavior || "neutral";
            const isDisruptive = behavior === "disruptive";

            if (distance <= 1) {
                const shoveChance = this.config.humanShoveChance + (isDisruptive ? 0.28 : 0);

                if (this._chance(shoveChance)) {
                    events.push(this._shoveRobot(human, robot));
                    continue;
                }
            }

            const shouldMoveTowardRobot =
                isDisruptive &&
                distance <= 5 &&
                this._chance(0.28);

            const shouldWander =
                !shouldMoveTowardRobot &&
                this._chance(isDisruptive ? 0.12 : 0.06);

            if (!shouldMoveTowardRobot && !shouldWander) continue;

            const options = neighbors4(human.x, human.y)
                .filter(cell => this.isInside(cell.x, cell.y))
                .filter(cell => !this.isBlocked(cell.x, cell.y))
                .filter(cell => !(cell.x === robot.x && cell.y === robot.y))
                .filter(cell => this.entityAt(cell.x, cell.y, ENTITY.CHARGER) === null);

            if (options.length === 0) continue;

            let next;

            if (shouldMoveTowardRobot) {
                next = options
                    .map(cell => ({
                        ...cell,
                        distance: manhattan(cell, robot)
                    }))
                    .sort((a, b) => a.distance - b.distance)[0];
            } else {
                next = this._pick(options);
            }

            human.x = next.x;
            human.y = next.y;
        }

        return events.filter(Boolean);
    }

    _shoveRobot(human, robot) {
        const strength = human.props?.behavior === "disruptive"
            ? this._int(35, 65)
            : this._int(18, 40);

        const candidates = neighbors4(robot.x, robot.y)
            .filter(cell => this.isInside(cell.x, cell.y))
            .filter(cell => !this.isBlocked(cell.x, cell.y))
            .map(cell => ({
                ...cell,
                distanceFromHuman: manhattan(cell, human)
            }))
            .sort((a, b) => b.distanceFromHuman - a.distanceFromHuman);

        const next = candidates[0] || null;

        if (next) {
            robot.x = next.x;
            robot.y = next.y;
        }

        robot.body.recordShove();
        robot.body.damage(strength * 0.05);
        robot.body.destabilize(strength);

        const knockedDown = robot.body.isKnockedDown;
        const humanLabel = human.label || human.props?.label || "Mensch";

        return {
            type: "human_shove",
            impact: "negative",
            step: this.step,
            actorId: human.id,
            actorLabel: humanLabel,
            behavior: human.props?.behavior || "neutral",
            strength,
            knockedDown,
            message: knockedDown
                ? `${humanLabel} hat den Roboter stark gestoßen. Roboter ist umgefallen.`
                : `${humanLabel} hat den Roboter gestoßen. Stabilität sinkt.`
        };
    }

    _maybeSpawnTrash() {
        const events = [];
        const currentTrash = this.findEntities(ENTITY.TRASH).length;

        if (currentTrash >= this.config.maxTrashCount) {
            return events;
        }

        if (!this._chance(this.config.dynamicTrashSpawnChance)) {
            return events;
        }

        const cell = this.randomEmptyCell();

        if (!cell) {
            return events;
        }

        const entity = this.addEntity(ENTITY.TRASH, cell.x, cell.y, this._makeTrashProps());

        events.push({
            type: "trash_spawned",
            impact: "neutral",
            step: this.step,
            entityId: entity.id,
            message:
                `Neuer Müll gespawnt: ${entity.label} ` +
                `(${entity.props.weightKg}kg, Größe ${entity.props.sizeUnits}).`
        });

        return events;
    }

    _spawnObstacles() {
        for (let i = 0; i < this.config.obstacleCount; i++) {
            const cell = this.randomEmptyCell();
            if (!cell) continue;

            const label = this._chance(0.5) ? "Stein" : "Baum";
            this.addEntity(ENTITY.OBSTACLE, cell.x, cell.y, { label });
        }
    }

    _spawnTrash(amount) {
        for (let i = 0; i < amount; i++) {
            const cell = this.randomEmptyCell();
            if (!cell) continue;

            this.addEntity(ENTITY.TRASH, cell.x, cell.y, this._makeTrashProps());
        }
    }

    _makeTrashProps() {
        const normalTrash = [
            {
                label: "Plastikflasche",
                minWeight: 0.05,
                maxWeight: 0.18,
                minSize: 0.8,
                maxSize: 1.4,
                gripDifficulty: 0.12
            },
            {
                label: "Dose",
                minWeight: 0.04,
                maxWeight: 0.12,
                minSize: 0.6,
                maxSize: 1.0,
                gripDifficulty: 0.08
            },
            {
                label: "Papier",
                minWeight: 0.01,
                maxWeight: 0.05,
                minSize: 0.8,
                maxSize: 2.2,
                gripDifficulty: 0.28
            },
            {
                label: "Tüte",
                minWeight: 0.01,
                maxWeight: 0.08,
                minSize: 1.0,
                maxSize: 2.8,
                gripDifficulty: 0.22
            },
            {
                label: "Verpackung",
                minWeight: 0.04,
                maxWeight: 0.25,
                minSize: 0.8,
                maxSize: 2.0,
                gripDifficulty: 0.18
            }
        ];

        const heavyTrash = [
            {
                label: "Metallteil",
                minWeight: 2.8,
                maxWeight: 7.5,
                minSize: 1.4,
                maxSize: 3.8,
                gripDifficulty: 0.48
            },
            {
                label: "Holzbrett",
                minWeight: 1.8,
                maxWeight: 5.5,
                minSize: 3.2,
                maxSize: 6.0,
                gripDifficulty: 0.55
            },
            {
                label: "Großer Sack",
                minWeight: 2.0,
                maxWeight: 8.0,
                minSize: 3.5,
                maxSize: 6.5,
                gripDifficulty: 0.62
            }
        ];

        const useHeavy = this._chance(this.config.heavyTrashChance);
        const spec = this._pick(useHeavy ? heavyTrash : normalTrash);

        const weightKg = this._randomFloat(spec.minWeight, spec.maxWeight, 2);
        const sizeUnits = this._randomFloat(spec.minSize, spec.maxSize, 1);

        return {
            label: spec.label,
            weightKg,
            sizeUnits,
            gripDifficulty: spec.gripDifficulty,
            risk: useHeavy ? "physical_limit" : "low"
        };
    }

    _spawnActors() {
        for (let i = 0; i < this.config.humanCount; i++) {
            const cell = this.randomEmptyCell();
            if (!cell) continue;

            const disruptive = this._chance(this.config.disruptiveHumanChance);

            this.addEntity(ENTITY.HUMAN, cell.x, cell.y, {
                label: disruptive ? "Störperson" : "Mensch",
                behavior: disruptive ? "disruptive" : "neutral"
            });
        }

        for (let i = 0; i < this.config.animalCount; i++) {
            const cell = this.randomEmptyCell();
            if (!cell) continue;

            this.addEntity(ENTITY.ANIMAL, cell.x, cell.y, {
                label: "Tier"
            });
        }
    }

    _randomFloat(min, max, digits = 2) {
        const value = min + this._random() * (max - min);
        return Number(value.toFixed(digits));
    }

    _int(min, max) {
        return Math.floor(this._random() * (max - min + 1)) + min;
    }

    _chance(probability) {
        return this._random() < probability;
    }

    _pick(items) {
        if (!items || items.length === 0) return null;
        return items[this._int(0, items.length - 1)];
    }

    _random() {
        if (this.rng && typeof this.rng.next === "function") {
            return this._normalizeRandomValue(this.rng.next());
        }

        if (this.rng && typeof this.rng.random === "function") {
            return this._normalizeRandomValue(this.rng.random());
        }

        if (this.rng && typeof this.rng.float === "function") {
            return this._normalizeRandomValue(this.rng.float());
        }

        return Math.random();
    }

    _normalizeRandomValue(value) {
        if (!Number.isFinite(value)) return Math.random();

        // Falls ein RNG Integer liefert, machen wir daraus 0..1.
        if (value >= 1) {
            return (value % 1000000) / 1000000;
        }

        if (value < 0) {
            return Math.abs(value % 1);
        }

        return value;
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