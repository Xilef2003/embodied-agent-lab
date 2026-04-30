import { ACTION, ENTITY } from "../config.js";
import { manhattan } from "../utils/Grid.js";

export class Actions {
    static execute(robot, world, action) {
        if (robot.body.isKnockedDown && action?.type !== ACTION.RECOVER) {
            return Actions._recover(robot, "Roboter ist umgefallen und muss sich zuerst aufrichten.");
        }

        if (!action || !action.type) {
            return Actions._idle(robot, "Keine Aktion gewählt.");
        }

        if (robot.body.battery <= 0 && action.type !== ACTION.CHARGE && action.type !== ACTION.RECOVER) {
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

            case ACTION.RECOVER:
                return Actions._recover(robot, action.reason || "Roboter richtet sich auf.");

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
        robot.body.stabilize(0.25);

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
            robot.body.destabilize(4);

            const blocker = world.entitiesAt(nextX, nextY).find(entity =>
                entity.type === ENTITY.OBSTACLE ||
                entity.type === ENTITY.HUMAN ||
                entity.type === ENTITY.ANIMAL
            );

            return {
                ok: false,
                type: ACTION.MOVE,
                message: `Blockiert durch ${blocker?.label || blocker?.props?.label || "Hindernis"}.`,
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

        const weightKg = Number(target.props?.weightKg ?? 0.1);
        const sizeUnits = Number(target.props?.sizeUnits ?? 1);
        const gripDifficulty = Number(target.props?.gripDifficulty ?? 0.15);

        if (!robot.body.canLift(weightKg)) {
            robot.body.recordFailedPickup();
            robot.body.destabilize(6);

            return {
                ok: false,
                type: ACTION.PICKUP,
                failureReason: "too_heavy",
                message:
                    `${target.label || target.props?.label || "Objekt"} ist zu schwer ` +
                    `(${weightKg}kg > Traglimit ${robot.body.maxLiftWeight}kg).`,
                target: target.clonePublic()
            };
        }

        if (!robot.body.canGrip(sizeUnits)) {
            robot.body.recordFailedPickup();
            robot.body.destabilize(4);

            return {
                ok: false,
                type: ACTION.PICKUP,
                failureReason: "too_large",
                message:
                    `${target.label || target.props?.label || "Objekt"} ist zu groß für den Greifer ` +
                    `(Größe ${sizeUnits} > Limit ${robot.body.maxGripSize}).`,
                target: target.clonePublic()
            };
        }

        const weightBonus = clamp((robot.body.maxLiftWeight - weightKg) * 0.04, 0, 0.16);
        const sizeBonus = clamp((robot.body.maxGripSize - sizeUnits) * 0.03, 0, 0.12);
        const successChance = clamp(1 - gripDifficulty + weightBonus + sizeBonus, 0.12, 0.98);

        if (Math.random() > successChance) {
            robot.body.recordFailedPickup();
            robot.body.destabilize(3);

            return {
                ok: false,
                type: ACTION.PICKUP,
                failureReason: "grip_failed",
                message:
                    `${target.label || target.props?.label || "Objekt"} ist beim Greifen entglitten ` +
                    `(Greifchance ${Math.round(successChance * 100)}%).`,
                target: target.clonePublic()
            };
        }

        const collectedTarget = target.clonePublic();

        world.removeEntity(target.id);
        robot.body.trashLoad++;
        robot.body.totalCollected++;
        robot.body.stabilize(1);
        robot.body.recordSuccess();

        return {
            ok: true,
            type: ACTION.PICKUP,
            message:
                `${collectedTarget.label || collectedTarget.props?.label || "Objekt"} eingesammelt ` +
                `(${weightKg}kg, Größe ${sizeUnits}).`,
            target: collectedTarget
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
        robot.body.stabilize(1.5);
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
                emptied: 0,
                message: "Behälter ist bereits leer."
            };
        }

        const emptied = robot.body.trashLoad;

        robot.body.trashLoad = 0;
        robot.body.totalEmptied += emptied;
        robot.body.stabilize(3);
        robot.body.recordSuccess();

        return {
            ok: true,
            type: ACTION.EMPTY,
            emptied,
            message: `${emptied} Müllobjekte an der Basis abgegeben.`
        };
    }

    static _scan(robot) {
        robot.body.drain(0.12);
        robot.body.stabilize(0.5);
        robot.body.recordSuccess();

        return {
            ok: true,
            type: ACTION.SCAN,
            message: "Umgebung gescannt."
        };
    }

    static _recover(robot, reason) {
        robot.body.drain(0.35);

        const recovered = robot.body.recoverStep();

        return {
            ok: recovered,
            type: ACTION.RECOVER,
            message: recovered
                ? "Roboter hat sich wieder aufgerichtet."
                : `${reason} Recovery läuft noch (${robot.body.recoveryTicksRemaining} Tick(s)).`
        };
    }

    static _idle(robot, reason) {
        robot.body.drain(0.05);
        robot.body.stabilize(0.4);

        return {
            ok: true,
            type: ACTION.IDLE,
            message: reason
        };
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}