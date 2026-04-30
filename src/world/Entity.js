let nextEntityId = 1;

export function resetEntityIds() {
    nextEntityId = 1;
}

export class Entity {
    constructor(type, x, y, props = {}) {
        this.id = props.id || `${type}_${nextEntityId++}`;
        this.type = type;
        this.x = x;
        this.y = y;
        this.label = props.label || type;
        this.props = { ...props };
    }

    get position() {
        return { x: this.x, y: this.y };
    }

    clonePublic() {
        return {
            id: this.id,
            type: this.type,
            label: this.label,
            x: this.x,
            y: this.y,
            props: { ...this.props }
        };
    }
}
