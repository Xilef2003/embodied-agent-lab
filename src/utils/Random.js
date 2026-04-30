export class RNG {
    constructor(seed = 1) {
        this.seed = seed >>> 0;
    }

    next() {
        this.seed = (1664525 * this.seed + 1013904223) >>> 0;
        return this.seed / 4294967296;
    }

    int(min, maxInclusive) {
        return Math.floor(this.next() * (maxInclusive - min + 1)) + min;
    }

    pick(items) {
        return items[this.int(0, items.length - 1)];
    }

    chance(probability) {
        return this.next() < probability;
    }
}
