import { WorldModel } from "./WorldModel.js";
import { NeedSystem } from "./NeedSystem.js";
import { EmotionSystem } from "./EmotionSystem.js";
import { GoalSystem } from "./GoalSystem.js";
import { Planner } from "./Planner.js";
import { LearningSystem } from "./LearningSystem.js";
import { SemanticMemory } from "./SemanticMemory.js";

export class Brain {
    constructor(worldWidth, worldHeight) {
        this.worldModel = new WorldModel(worldWidth, worldHeight);
        this.semanticMemory = new SemanticMemory();

        this.needSystem = new NeedSystem();
        this.emotionSystem = new EmotionSystem();
        this.goalSystem = new GoalSystem();
        this.planner = new Planner();
        this.learningSystem = new LearningSystem();

        this.current = {
            needs: {},
            emotions: {},
            goal: null,
            action: null,
            semantic: null
        };
    }

    decide(robot, observation) {
        this.worldModel.update(observation);

        const semantic = this.semanticMemory.evaluateObservation(
            observation,
            this.worldModel,
            robot
        );

        const learningState = this.learningSystem.getState();
        const needs = this.needSystem.evaluate(robot, observation, this.worldModel);
        const emotions = this.emotionSystem.evaluate(needs, learningState, robot);

        const goal = this.goalSystem.choose(
            needs,
            emotions,
            robot,
            this.worldModel,
            semantic
        );

        const action = this.planner.plan(
            goal,
            this.worldModel,
            robot,
            observation,
            emotions,
            semantic
        );

        this.current = {
            needs,
            emotions,
            goal,
            action,
            semantic
        };

        return action;
    }

    learn(action, result, observation, robot) {
        this.worldModel.integrateActionResult(action, result);
        return this.learningSystem.learn(action, result, observation, robot);
    }

    explainConcept(concept) {
        return this.semanticMemory.explainConcept(concept);
    }

    getState() {
        return {
            ...this.current,
            learning: this.learningSystem.getState(),
            knownCellsRatio: this.worldModel.getKnownCellRatio(),
            knownTrashCount: this.worldModel.getKnownTrash().length,
            semanticCollectableCount: this.current.semantic?.collectableTargets?.length ?? 0,
            semanticHazardCount: this.current.semantic?.hazards?.length ?? 0,
            relationCount: this.current.semantic?.relationCount ?? 0,
            affordanceCount: this.current.semantic?.affordanceCount ?? 0,
            homeKnown: Boolean(this.worldModel.home),
            recentLogLines: this.learningSystem.getRecentLogLines(12)
        };
    }
}