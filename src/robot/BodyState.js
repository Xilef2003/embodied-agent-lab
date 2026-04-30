import { clamp } from "../utils/Grid.js";

export class BodyState {
    constructor(options = {}) {
        this.maxBattery = options.maxBattery ?? 100;
        this.battery = options.battery ?? this.maxBattery;

        this.maxTrashLoad = options.maxTrashLoad ?? 6;
        this.trashLoad = options.trashLoad ?? 0;

        this.health = options.health ?? 100;
        this.failedActions = 0;
        this.successfulActions = 0;
        this.totalCollected = 0;
        this.totalEmptied = 0;
    }

    get batteryRatio() {
        return this.battery / this.maxBattery;
    }

    get loadRatio() {
        return this.trashLoad / this.maxTrashLoad;
    }

    get isBatteryCritical() {
        return this.battery <= 12;
    }

    get isBatteryLow() {
        return this.battery <= 25;
    }

    get isLoadFull() {
        return this.trashLoad >= this.maxTrashLoad;
    }

    drain(amount) {
        this.battery = clamp(this.battery - amount, 0, this.maxBattery);
    }

    charge(amount) {
        this.battery = clamp(this.battery + amount, 0, this.maxBattery);
    }

    damage(amount) {
        this.health = clamp(this.health - amount, 0, 100);
    }

    recordSuccess() {
        this.successfulActions++;
        this.failedActions = Math.max(0, this.failedActions - 1);
    }

    recordFailure() {
        this.failedActions++;
    }
}
