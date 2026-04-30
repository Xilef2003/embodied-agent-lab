export const CONFIG = {
    gridWidth: 32,
    gridHeight: 22,
    cellSize: 30,

    sensorRange: 5,

    trashCount: 26,
    obstacleCount: 48,
    humanCount: 2,
    animalCount: 3,

    robotTrashCapacity: 6,

    initialSeed: 42
};

export const ENTITY = Object.freeze({
    TRASH: "trash",
    OBSTACLE: "obstacle",
    CHARGER: "charger",
    HUMAN: "human",
    ANIMAL: "animal"
});

export const ACTION = Object.freeze({
    MOVE: "move",
    PICKUP: "pickup",
    CHARGE: "charge",
    EMPTY: "empty",
    SCAN: "scan",
    IDLE: "idle"
});

export const GOAL = Object.freeze({
    CHARGE: "charge",
    EMPTY_LOAD: "empty_load",
    COLLECT_TRASH: "collect_trash",
    EXPLORE: "explore",
    AVOID: "avoid",
    RETURN_HOME: "return_home",
    STANDBY: "standby",

    // v1.1:
    // Der Agent kehrt bewusst in eine interessante Region zurück,
    // weil dort historisch Müll/Risiken/Unsicherheit beobachtet wurden.
    PATROL_AREA: "patrol_area"
});