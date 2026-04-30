export class BodyState {
    constructor(options = {}) {
        this.maxBattery = options.maxBattery ?? 100;
        this.battery = options.battery ?? this.maxBattery;

        this.maxTrashLoad = options.maxTrashLoad ?? 6;
        this.trashLoad = options.trashLoad ?? 0;

        this.health = options.health ?? 100;

        // v1.2: physische Grenzen
        this.maxLiftWeight = options.maxLiftWeight ?? 2.5;
        this.maxGripSize = options.maxGripSize ?? 3.0;

        // v1.2: Stabilität / Umfallen
        this.stability = options.stability ?? 100;
        this.isKnockedDown = false;
        this.recoveryTicksRemaining = 0;

        this.failedActions = 0;
        this.successfulActions = 0;
        this.totalCollected = 0;
        this.totalEmptied = 0;
        this.totalFailedPickups = 0;
        this.totalShoves = 0;
        this.totalFalls = 0;
    }

    get batteryRatio() {
        return this.battery / this.maxBattery;
    }

    get loadRatio() {
        return this.trashLoad / this.maxTrashLoad;
    }

    get stabilityRatio() {
        return this.stability / 100;
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

    canLift(weight) {
        return Number(weight ?? 0) <= this.maxLiftWeight;
    }

    canGrip(size) {
        return Number(size ?? 0) <= this.maxGripSize;
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

    destabilize(amount) {
        this.stability = clamp(this.stability - amount, 0, 100);

        if (this.stability <= 0 && !this.isKnockedDown) {
            this.knockDown();
        }
    }

    stabilize(amount) {
        this.stability = clamp(this.stability + amount, 0, 100);
    }

    knockDown(ticks = 3) {
        this.isKnockedDown = true;
        this.recoveryTicksRemaining = Math.max(this.recoveryTicksRemaining, ticks);
        this.totalFalls++;
        this.recordFailure();
    }

    recoverStep() {
        if (!this.isKnockedDown) {
            this.stabilize(10);
            return true;
        }

        this.recoveryTicksRemaining--;
        this.stabilize(28);

        if (this.recoveryTicksRemaining <= 0) {
            this.isKnockedDown = false;
            this.recoveryTicksRemaining = 0;
            this.stability = Math.max(this.stability, 55);
            this.recordSuccess();
            return true;
        }

        return false;
    }

    recordSuccess() {
        this.successfulActions++;
        this.failedActions = Math.max(0, this.failedActions - 1);
    }

    recordFailure() {
        this.failedActions++;
    }

    recordFailedPickup() {
        this.totalFailedPickups++;
        this.recordFailure();
    }

    recordShove() {
        this.totalShoves++;
        this.recordFailure();
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}