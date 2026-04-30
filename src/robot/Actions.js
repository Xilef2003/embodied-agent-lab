import { ACTION, ENTITY } from "../config.js";
import { manhattan } from "../utils/Grid.js";

export class Actions {
    static execute(robot, world, action) {
        if (!action || !action.type) {
            return Actions._idle(robot, "Keine Aktion gewählt.");
        }

        if (robot.body.battery <= 0 && action.type !== ACTION.CHARGE) {
            robot.body.recordFailure();
            return {
                ok: false,
                type: action.type,
                message: "Akku leer. Der Roboter kann nicht handeln."
            };
        }

        switch (action.type) {
            case ACTION.MOVE:
                return Actions._move(robot, world, action);

            case ACTION.PICKUP:
                return Actions._pickup(robot, world, action);

            case ACTION.CHARGE:
                return Actions._charge(robot, world);

            case ACTION.EMPTY:
                return Actions._empty(robot, world);

            case ACTION.SCAN:
                return Actions._scan(robot);

            case ACTION.IDLE:
            default:
                return Actions._idle(robot, action.reason || "Warten.");
        }
    }

    static _move(robot, world, action) {
        const dx = action.dx ?? 0;
        const dy = action.dy ?? 0;
        const nextX = robot.x + dx;
        const nextY = robot.y + dy;

        robot.body.drain(0.42);

        if (Math.abs(dx) + Math.abs(dy) !== 1) {
            robot.body.recordFailure();
            return {
                ok: false,
                type: ACTION.MOVE,
                message: "Ungültige Bewegung.",
                blockedCell: { x: nextX, y: nextY }
            };
        }

        if (!world.isInside(nextX, nextY)) {
            robot.body.recordFailure();
            return {
                ok: false,
                type: ACTION.MOVE,
                message: "Rand der Welt erreicht.",
                blockedCell: { x: nextX, y: nextY }
            };
        }

        if (world.isBlocked(nextX, nextY)) {
            robot.body.recordFailure();
            robot.body.damage(0.15);

            const blocker = world.entitiesAt(nextX, nextY).find(entity =>
                entity.type === ENTITY.OBSTACLE ||
                entity.type === ENTITY.HUMAN ||
                entity.type === ENTITY.ANIMAL
            );

            return {
                ok: false,
                type: ACTION.MOVE,
                message: `Blockiert durch ${blocker?.label || "Hindernis"}.`,
                blockedCell: { x: nextX, y: nextY },
                blocker: blocker?.clonePublic() || null
            };
        }

        robot.x = nextX;
        robot.y = nextY;
        robot.body.recordSuccess();

        return {
            ok: true,
            type: ACTION.MOVE,
            message: `Bewegt nach (${robot.x}, ${robot.y}).`
        };
    }

    static _pickup(robot, world, action) {
        robot.body.drain(0.9);

        if (robot.body.isLoadFull) {
            robot.body.recordFailure();
            return {
                ok: false,
                type: ACTION.PICKUP,
                message: "Behälter ist voll."
            };
        }

        let target = action.targetId ? world.getEntity(action.targetId) : null;

        if (!target) {
            target = world.findEntities(ENTITY.TRASH)
                .filter(entity => manhattan(robot, entity) <= 1)
                .sort((a, b) => manhattan(robot, a) - manhattan(robot, b))[0] || null;
        }

        if (!target || target.type !== ENTITY.TRASH) {
            robot.body.recordFailure();
            return {
                ok: false,
                type: ACTION.PICKUP,
                message: "Kein greifbarer Müll in Reichweite."
            };
        }

        if (manhattan(robot, target) > 1) {
            robot.body.recordFailure();
            return {
                ok: false,
                type: ACTION.PICKUP,
                message: "Müll ist zu weit weg.",
                target: target.clonePublic()
            };
        }

        world.removeEntity(target.id);
        robot.body.trashLoad++;
        robot.body.totalCollected++;
        robot.body.recordSuccess();

        return {
            ok: true,
            type: ACTION.PICKUP,
            message: `${target.label} eingesammelt.`,
            target: target.clonePublic()
        };
    }

    static _charge(robot, world) {
        const charger = world.getCharger();

        if (!charger || manhattan(robot, charger) > 0) {
            robot.body.drain(0.08);
            robot.body.recordFailure();
            return {
                ok: false,
                type: ACTION.CHARGE,
                message: "Nicht auf der Ladestation."
            };
        }

        robot.body.charge(4.8);
        robot.body.recordSuccess();

        return {
            ok: true,
            type: ACTION.CHARGE,
            message: "Akku wird geladen."
        };
    }

    static _empty(robot, world) {
        const charger = world.getCharger();

        if (!charger || manhattan(robot, charger) > 0) {
            robot.body.drain(0.08);
            robot.body.recordFailure();
            return {
                ok: false,
                type: ACTION.EMPTY,
                message: "Behälter kann nur an der Basis geleert werden."
            };
        }

        if (robot.body.trashLoad === 0) {
            return {
                ok: true,
                type: ACTION.EMPTY,
                message: "Behälter ist bereits leer."
            };
        }

        const emptied = robot.body.trashLoad;
        robot.body.trashLoad = 0;
        robot.body.totalEmptied += emptied;
        robot.body.recordSuccess();

        return {
            ok: true,
            type: ACTION.EMPTY,
            message: `${emptied} Müllobjekte an der Basis abgegeben.`,
            emptied
        };
    }

    static _scan(robot) {
        robot.body.drain(0.12);
        robot.body.recordSuccess();

        return {
            ok: true,
            type: ACTION.SCAN,
            message: "Umgebung gescannt."
        };
    }

    static _idle(robot, reason) {
        robot.body.drain(0.05);

        return {
            ok: true,
            type: ACTION.IDLE,
            message: reason
        };
    }
}
