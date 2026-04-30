import { clamp } from "../utils/Grid.js";

export class EmotionSystem {
    constructor() {
        this.state = {
            caution: 0,
            urgency: 0,
            curiosity: 0,
            frustration: 0,
            satisfaction: 0
        };
    }

    evaluate(needs, learningState, robot) {
        const recentFailures = learningState.recentFailures ?? 0;
        const recentSuccesses = learningState.recentSuccesses ?? 0;

        this.state = {
            caution: clamp(needs.safety * 0.85 + needs.returnRisk * 0.35, 0, 1),
            urgency: clamp(needs.energy * 0.75 + needs.returnRisk * 0.55, 0, 1),
            curiosity: clamp(needs.curiosity * (robot.body.batteryRatio > 0.35 ? 1 : 0.25), 0, 1),
            frustration: clamp(recentFailures / 5, 0, 1),
            satisfaction: clamp(recentSuccesses / 7, 0, 1)
        };

        return this.state;
    }
}
