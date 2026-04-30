export function keyOf(x, y) {
    return `${x},${y}`;
}

export function parseKey(key) {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
}

export function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function chebyshev(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function neighbors4(x, y) {
    return [
        { x: x + 1, y },
        { x: x - 1, y },
        { x, y: y + 1 },
        { x, y: y - 1 }
    ];
}

export function directionFromTo(from, to) {
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);

    if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)) {
        return { dx, dy: 0 };
    }

    return { dx: 0, dy };
}
