import { WorldModel } from "./WorldModel.js";
import { NeedSystem } from "./NeedSystem.js";
import { EmotionSystem } from "./EmotionSystem.js";
import { GoalSystem } from "./GoalSystem.js";
import { Planner } from "./Planner.js";
import { LearningSystem } from "./LearningSystem.js";
import { SemanticMemory } from "./SemanticMemory.js";
import { ExperienceLearner } from "./ExperienceLearner.js";
import { ExperienceSummary } from "./ExperienceSummary.js";
import { UtilityEvaluator } from "./UtilityEvaluator.js";
import { SpatialMemory } from "./SpatialMemory.js";
import { UncollectableMemory } from "./UncollectableMemory.js";

export class Brain {
    constructor(worldWidth, worldHeight) {
        this.worldModel = new WorldModel(worldWidth, worldHeight);
        this.semanticMemory = new SemanticMemory();
        this.experienceLearner = new ExperienceLearner();
        this.experienceSummary = new ExperienceSummary();
        this.utilityEvaluator = new UtilityEvaluator();
        this.spatialMemory = new SpatialMemory(worldWidth, worldHeight);
        this.uncollectableMemory = new UncollectableMemory();

        this.needSystem = new NeedSystem();
        this.emotionSystem = new EmotionSystem();
        this.goalSystem = new GoalSystem();
        this.planner = new Planner();
        this.learningSystem = new LearningSystem();

        this.lastRobotPosition = null;
        this.lastWorldStep = 0;

        this.current = {
            needs: {},
            emotions: {},
            goal: null,
            action: null,
            semantic: null,
            experience: null,
            experienceSummary: null,
            spatial: null,
            uncollectable: null
        };
    }

    decide(robot, observation) {
        this.lastRobotPosition = robot.position;
        this.lastWorldStep = observation.step;

        this.worldModel.update(observation);

        const rawSemantic = this.semanticMemory.evaluateObservation(
            observation,
            this.worldModel,
            robot
        );

        const semantic = this.utilityEvaluator.evaluate(
            rawSemantic,
            robot,
            this.worldModel,
            this.experienceSummary
        );

        this.uncollectableMemory.ingestUtilityTargets(
            semantic.utility?.uncollectableTargets || [],
            observation.step
        );

        this.spatialMemory.update(observation, semantic, robot);

        const spatial = this.spatialMemory.getState(
            robot.position,
            observation.step
        );

        const uncollectable = this.uncollectableMemory.getState(observation.step);

        const learningState = this.learningSystem.getState();
        const needs = this.needSystem.evaluate(robot, observation, this.worldModel);
        const emotions = this.emotionSystem.evaluate(needs, learningState, robot);

        const goal = this.goalSystem.choose(
            needs,
            emotions,
            robot,
            this.worldModel,
            semantic,
            spatial
        );

        const action = this.planner.plan(
            goal,
            this.worldModel,
            robot,
            observation,
            emotions,
            semantic,
            spatial
        );

        this.current = {
            ...this.current,
            needs,
            emotions,
            goal,
            action,
            semantic,
            spatial,
            uncollectable
        };

        return action;
    }

    learn(action, result, observation, robot) {
        const experienceEvents = this.experienceLearner.learn(
            action,
            result,
            observation,
            robot,
            this.worldModel,
            this.semanticMemory
        );

        const summaryEvents = this.experienceSummary.ingestEvents(
            experienceEvents,
            this.semanticMemory
        );

        if (result?.ok && result.type === "pickup" && result.target) {
            this.spatialMemory.registerPickup(result.target, observation.step);
            this.uncollectableMemory.ingestPickupSuccess(
                result,
                observation.step,
                this.semanticMemory
            );
        }

        if (!result?.ok && result?.type === "pickup" && result.target) {
            this.uncollectableMemory.ingestPickupFailure(
                result,
                observation.step,
                this.semanticMemory
            );
        }

        if (!result?.ok && result?.blockedCell) {
            this.spatialMemory.registerBlockedCell(
                result.blockedCell.x,
                result.blockedCell.y,
                observation.step
            );
        }

        this.worldModel.integrateActionResult(action, result);

        const episode = this.learningSystem.learn(
            action,
            result,
            observation,
            robot
        );

        const visibleAction = result?.type === "recover"
            ? {
                type: "recover",
                reason: result.message
            }
            : action;

        this.current = {
            ...this.current,
            action: visibleAction,
            experience: this.experienceLearner.getState(),
            experienceSummary: this.experienceSummary.getState(this.semanticMemory),
            spatial: this.spatialMemory.getState(robot.position, observation.step),
            uncollectable: this.uncollectableMemory.getState(observation.step)
        };

        return {
            episode,
            experienceEvents,
            summaryEvents
        };
    }

    recordExternalEvents(events = [], robot = null) {
        for (const event of events) {
            this.learningSystem.recordExternalEvent(event);
        }

        if (robot) {
            this.lastRobotPosition = robot.position;
        }
    }

    explainConcept(concept) {
        return {
            semantic: this.semanticMemory.explainConcept(concept),
            experience: this.experienceSummary.getProfile(concept)
        };
    }

    getState() {
        const experienceState = this.experienceLearner.getState();
        const summaryState = this.experienceSummary.getState(this.semanticMemory);
        const spatialState = this.spatialMemory.getState(
            this.lastRobotPosition,
            this.lastWorldStep
        );
        const uncollectableState = this.uncollectableMemory.getState(this.lastWorldStep);

        const summaryLines = summaryState.recentEvents
            .slice(-4)
            .map(event => `[summary] ${event.message}`);

        const spatialLines = (this.current.spatial?.recentEvents || [])
            .slice(-2)
            .map(event => `[place] ${event.message}`);

        const uncollectableLines = (uncollectableState.recentEvents || [])
            .slice(-2)
            .map(event => `[body-limit] ${event.message}`);

        return {
            ...this.current,

            learning: this.learningSystem.getState(),
            experience: experienceState,
            experienceSummary: summaryState,
            spatial: this.current.spatial || spatialState,
            uncollectable: this.current.uncollectable || uncollectableState,

            knownCellsRatio: this.worldModel.getKnownCellRatio(),
            knownTrashCount: this.worldModel.getKnownTrash().length,

            semanticCollectableCount: this.current.semantic?.collectableTargets?.length ?? 0,
            semanticActionableCount: this.current.semantic?.utility?.actionableTargets?.length ?? 0,
            semanticUncollectableCount: this.current.semantic?.utility?.uncollectableTargets?.length ?? 0,
            semanticHazardCount: this.current.semantic?.hazards?.length ?? 0,
            relationCount: this.current.semantic?.relationCount ?? 0,
            affordanceCount: this.current.semantic?.affordanceCount ?? 0,

            utilityTopTarget: this.current.semantic?.utility?.topCollectableTarget ?? null,
            utilityTopActionableTarget: this.current.semantic?.utility?.topActionableTarget ?? null,
            utilityRankedTargets: this.current.semantic?.utility?.rankedCollectableTargets ?? [],
            utilityActionableTargets: this.current.semantic?.utility?.actionableTargets ?? [],
            utilityUncollectableTargets: this.current.semantic?.utility?.uncollectableTargets ?? [],
            decisionExplanation: this.current.semantic?.utility?.decisionExplanation ?? null,

            spatialBestPatrolRegion: this.current.spatial?.bestPatrolRegion ?? null,
            spatialTopRegions: this.current.spatial?.topRegions ?? [],
            spatialRegionCount: this.current.spatial?.regionCount ?? 0,

            uncollectableCount: uncollectableState.count,
            uncollectableItems: uncollectableState.items,
            uncollectableConceptProfiles: uncollectableState.conceptProfiles,

            semanticEvents: this.current.semantic?.recentSemanticEvents ?? [],
            experienceEventCount: experienceState.eventCount,
            experienceConceptCount: summaryState.conceptCount,
            experienceProfiles: summaryState.profiles,
            recentExperienceEvents: experienceState.recentEvents,
            recentSummaryEvents: summaryState.recentEvents,

            homeKnown: Boolean(this.worldModel.home),

            recentLogLines: [
                ...this.learningSystem.getRecentLogLines(8),
                ...summaryLines,
                ...spatialLines,
                ...uncollectableLines
            ]
        };
    }
}