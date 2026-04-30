import { clamp, manhattan } from "../utils/Grid.js";

export class NeedSystem {
    evaluate(robot, observation, worldModel) {
        const body = robot.body;
        const position = robot.position;

        const energyNeed = clamp(1 - body.batteryRatio, 0, 1);
        const unloadNeed = body.loadRatio;

        const knownTrash = worldModel.getKnownTrash();
        const visibleTrashCount = observation.visibleEntities
            .filter(entity => entity.type === "trash").length;

        const missionNeed = clamp(
            (knownTrash.length > 0 ? 0.45 : 0) +
            Math.min(0.45, visibleTrashCount * 0.15),
            0,
            1
        );

        const hazards = worldModel.getKnownHazards(position, 2);
        const safetyNeed = hazards.length > 0
            ? clamp(1 - manhattan(position, hazards[0]) / 3, 0.25, 1)
            : 0;

        const curiosityNeed = clamp(1 - worldModel.getKnownCellRatio(), 0, 1);

        const distanceToHome = worldModel.home ? manhattan(position, worldModel.home) : Infinity;
        const estimatedReturnCost = Number.isFinite(distanceToHome)
            ? distanceToHome * 0.55 + 8
            : 35;

        const returnRisk = body.battery < estimatedReturnCost
            ? clamp((estimatedReturnCost - body.battery) / 30, 0, 1)
            : 0;

        return {
            energy: energyNeed,
            unload: unloadNeed,
            mission: missionNeed,
            safety: safetyNeed,
            curiosity: curiosityNeed,
            returnRisk,
            distanceToHome
        };
    }
}
