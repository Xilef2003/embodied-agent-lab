import { ENTITY } from "../config.js";
import { chebyshev, manhattan } from "../utils/Grid.js";

export class Sensors {
    static scan(robot, world) {
        const range = robot.sensorRange;
        const visibleCells = [];
        const visibleEntities = [];

        for (let y = robot.y - range; y <= robot.y + range; y++) {
            for (let x = robot.x - range; x <= robot.x + range; x++) {
                if (!world.isInside(x, y)) continue;

                const distance = chebyshev(robot, { x, y });
                if (distance > range) continue;

                const entities = world.entitiesAt(x, y);
                const blockingEntity = entities.find(entity =>
                    entity.type === ENTITY.OBSTACLE ||
                    entity.type === ENTITY.HUMAN ||
                    entity.type === ENTITY.ANIMAL
                );

                visibleCells.push({
                    x,
                    y,
                    distance,
                    blocked: Boolean(blockingEntity),
                    entityTypes: entities.map(entity => entity.type)
                });

                for (const entity of entities) {
                    visibleEntities.push({
                        ...entity.clonePublic(),
                        distance: manhattan(robot, entity)
                    });
                }
            }
        }

        return {
            step: world.step,
            robot: {
                x: robot.x,
                y: robot.y,
                battery: robot.body.battery,
                batteryRatio: robot.body.batteryRatio,
                trashLoad: robot.body.trashLoad,
                maxTrashLoad: robot.body.maxTrashLoad,
                health: robot.body.health
            },
            visibleCells,
            visibleEntities
        };
    }
}
