import { CONFIG } from "../config.js";
import { BodyState } from "./BodyState.js";
import { Sensors } from "./Sensors.js";
import { Actions } from "./Actions.js";

export class Robot {
    constructor(x, y, config = CONFIG) {
        this.x = x;
        this.y = y;
        this.sensorRange = config.sensorRange;
        this.body = new BodyState({
            maxTrashLoad: config.robotTrashCapacity
        });
    }

    get position() {
        return { x: this.x, y: this.y };
    }

    sense(world) {
        return Sensors.scan(this, world);
    }

    execute(world, action) {
        return Actions.execute(this, world, action);
    }
}
