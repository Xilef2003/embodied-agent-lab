import { ENTITY } from "../config.js";
import { keyOf, manhattan } from "../utils/Grid.js";

export class SpatialMemory {
    constructor(width, height, options = {}) {
        this.width = width;
        this.height = height;

        this.config = {
            regionSize: 5,
            maxRecentEvents: 80,

            // Wie stark unterschiedliche Erfahrungen die Wichtigkeit einer Region beeinflussen.
            trashWeight: 2.4,
            hazardWeight: 1.1,
            noveltyWeight: 1.2,
            stalenessWeight: 1.4,
            safetyPenaltyWeight: 0.75,

            // Ab welchem Score eine Region als lohnendes Patrouillenziel gilt.
            minPatrolScore: 0.28,

            ...options
        };

        this.regions = new Map();
        this.recentEvents = [];
        this.totalUpdates = 0;
    }

    update(observation, semantic = null, robot = null) {
        if (!observation) return;

        this.totalUpdates++;

        const robotRegion = this.getRegionForCell(
            observation.robot.x,
            observation.robot.y
        );

        robotRegion.visitCount++;
        robotRegion.lastVisitedStep = observation.step;
        robotRegion.lastRobotPosition = {
            x: observation.robot.x,
            y: observation.robot.y
        };

        const visibleSemanticById = new Map();

        for (const item of semantic?.visibleEntities || []) {
            visibleSemanticById.set(item.id, item);
        }

        const seenCellKeys = new Set();

        for (const cell of observation.visibleCells || []) {
            const region = this.getRegionForCell(cell.x, cell.y);
            const cellKey = keyOf(cell.x, cell.y);

            if (!region.knownCells.has(cellKey)) {
                region.knownCells.add(cellKey);
                region.discoveryCount++;
            }

            seenCellKeys.add(cellKey);

            region.lastSeenStep = observation.step;
            region.seenCount++;
        }

        for (const entity of observation.visibleEntities || []) {
            const region = this.getRegionForCell(entity.x, entity.y);
            const semanticEntity = visibleSemanticById.get(entity.id);

            region.lastSeenStep = observation.step;

            if (entity.type === ENTITY.TRASH || semanticEntity?.collectable) {
                region.trashSeen++;
                region.lastTrashStep = observation.step;
                region.trashConcepts.set(
                    semanticEntity?.concept || "muell",
                    (region.trashConcepts.get(semanticEntity?.concept || "muell") || 0) + 1
                );

                this._recordEvent({
                    kind: "trash_seen",
                    regionId: region.id,
                    message: `${entity.label} in Region ${region.id} gesehen.`
                });
            }

            if (entity.type === ENTITY.ANIMAL || entity.type === ENTITY.HUMAN || semanticEntity?.shouldAvoid) {
                region.hazardSeen++;
                region.lastHazardStep = observation.step;
                region.hazardConcepts.set(
                    semanticEntity?.concept || entity.type,
                    (region.hazardConcepts.get(semanticEntity?.concept || entity.type) || 0) + 1
                );

                this._recordEvent({
                    kind: "hazard_seen",
                    regionId: region.id,
                    message: `${entity.label} in Region ${region.id} als Risiko gesehen.`
                });
            }

            if (entity.type === ENTITY.OBSTACLE) {
                region.obstacleSeen++;
            }
        }

        this._recomputeAllScores(observation.step);
    }

    registerPickup(entity, step) {
        if (!entity) return;

        const region = this.getRegionForCell(entity.x, entity.y);

        region.trashCollected++;
        region.lastTrashCollectedStep = step;

        this._recordEvent({
            kind: "trash_collected",
            regionId: region.id,
            message: `${entity.label} in Region ${region.id} eingesammelt.`
        });

        this._recomputeAllScores(step);
    }

    registerBlockedCell(x, y, step) {
        const region = this.getRegionForCell(x, y);

        region.blockedMovement++;
        region.lastBlockedStep = step;

        this._recordEvent({
            kind: "blocked_movement",
            regionId: region.id,
            message: `Bewegung in Region ${region.id} blockiert.`
        });

        this._recomputeAllScores(step);
    }

    getBestPatrolRegion(robotPosition, currentStep) {
        this._recomputeAllScores(currentStep);

        const candidates = [...this.regions.values()]
            .filter(region => region.score >= this.config.minPatrolScore)
            .map(region => {
                const center = this._regionCenter(region);
                const distance = robotPosition
                    ? manhattan(robotPosition, center)
                    : 0;

                // Weit entfernte Regionen sind nicht verboten, aber etwas weniger attraktiv.
                const distancePenalty = Math.min(0.25, distance / 80);

                return {
                    ...this._publicRegion(region, currentStep),
                    target: center,
                    distance,
                    finalScore: Math.max(0, region.score - distancePenalty)
                };
            })
            .sort((a, b) => b.finalScore - a.finalScore);

        return candidates[0] || null;
    }

    getTopRegions(currentStep, limit = 6) {
        this._recomputeAllScores(currentStep);

        return [...this.regions.values()]
            .map(region => this._publicRegion(region, currentStep))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    getState(robotPosition = null, currentStep = 0) {
        const bestPatrolRegion = this.getBestPatrolRegion(robotPosition, currentStep);

        return {
            regionCount: this.regions.size,
            totalUpdates: this.totalUpdates,
            bestPatrolRegion,
            topRegions: this.getTopRegions(currentStep),
            recentEvents: this.recentEvents.slice(-8)
        };
    }

    getRegionForCell(x, y) {
        const rx = Math.floor(x / this.config.regionSize);
        const ry = Math.floor(y / this.config.regionSize);
        const id = `${rx},${ry}`;

        if (!this.regions.has(id)) {
            const minX = rx * this.config.regionSize;
            const minY = ry * this.config.regionSize;
            const maxX = Math.min(this.width - 1, minX + this.config.regionSize - 1);
            const maxY = Math.min(this.height - 1, minY + this.config.regionSize - 1);

            this.regions.set(id, {
                id,
                rx,
                ry,
                minX,
                minY,
                maxX,
                maxY,

                visitCount: 0,
                seenCount: 0,
                discoveryCount: 0,
                knownCells: new Set(),

                trashSeen: 0,
                trashCollected: 0,
                hazardSeen: 0,
                obstacleSeen: 0,
                blockedMovement: 0,

                trashConcepts: new Map(),
                hazardConcepts: new Map(),

                lastSeenStep: null,
                lastVisitedStep: null,
                lastTrashStep: null,
                lastTrashCollectedStep: null,
                lastHazardStep: null,
                lastBlockedStep: null,
                lastRobotPosition: null,

                trashScore: 0,
                hazardScore: 0,
                noveltyScore: 1,
                stalenessScore: 1,
                score: 0,
                risk: 0,
                summary: ""
            });
        }

        return this.regions.get(id);
    }

    _recomputeAllScores(currentStep) {
        for (const region of this.regions.values()) {
            this._recomputeRegionScore(region, currentStep);
        }
    }

    _recomputeRegionScore(region, currentStep) {
        const area = (region.maxX - region.minX + 1) * (region.maxY - region.minY + 1);
        const knownRatio = area > 0 ? region.knownCells.size / area : 0;

        const trashSignal = region.trashSeen + region.trashCollected * 1.5;
        const hazardSignal = region.hazardSeen;
        const blockedSignal = region.blockedMovement + region.obstacleSeen * 0.25;

        region.trashScore = this._saturatingScore(trashSignal, 4);
        region.hazardScore = this._saturatingScore(hazardSignal, 4);
        region.noveltyScore = Math.max(0, 1 - knownRatio);

        const lastRelevantStep = Math.max(
            region.lastVisitedStep ?? 0,
            region.lastSeenStep ?? 0
        );

        const stepsSinceSeen = Math.max(0, currentStep - lastRelevantStep);
        region.stalenessScore = this._saturatingScore(stepsSinceSeen, 120);

        // Risiko ist wichtig, aber nicht automatisch schlecht:
        // Wenn dort Tiere sind, soll der Agent vorsichtig sein,
        // aber die Region kann trotzdem interessant bleiben.
        region.risk = this._saturatingScore(hazardSignal + blockedSignal, 6);

        const positive =
            region.trashScore * this.config.trashWeight +
            region.noveltyScore * this.config.noveltyWeight +
            region.stalenessScore * this.config.stalenessWeight +
            region.hazardScore * this.config.hazardWeight;

        const penalty = region.risk * this.config.safetyPenaltyWeight;

        region.score = this._clamp((positive / 6) - penalty * 0.35);

        region.summary = this._makeRegionSummary(region, knownRatio);
    }

    _makeRegionSummary(region, knownRatio) {
        const parts = [];

        parts.push(`Region ${region.id}`);
        parts.push(`${Math.round(knownRatio * 100)}% bekannt`);

        if (region.trashSeen > 0 || region.trashCollected > 0) {
            parts.push(`${region.trashSeen}x Müll gesehen`);
            if (region.trashCollected > 0) {
                parts.push(`${region.trashCollected}x Müll gesammelt`);
            }
        }

        if (region.hazardSeen > 0) {
            parts.push(`${region.hazardSeen}x Risiko gesehen`);
        }

        if (region.stalenessScore > 0.5) {
            parts.push("lange nicht geprüft");
        }

        return parts.join(" · ");
    }

    _publicRegion(region, currentStep) {
        const center = this._regionCenter(region);

        return {
            id: region.id,
            rx: region.rx,
            ry: region.ry,
            bounds: {
                minX: region.minX,
                minY: region.minY,
                maxX: region.maxX,
                maxY: region.maxY
            },
            center,

            visitCount: region.visitCount,
            seenCount: region.seenCount,
            discoveryCount: region.discoveryCount,

            trashSeen: region.trashSeen,
            trashCollected: region.trashCollected,
            hazardSeen: region.hazardSeen,
            obstacleSeen: region.obstacleSeen,
            blockedMovement: region.blockedMovement,

            lastSeenStep: region.lastSeenStep,
            lastVisitedStep: region.lastVisitedStep,
            stepsSinceSeen:
                region.lastSeenStep === null
                    ? null
                    : Math.max(0, currentStep - region.lastSeenStep),

            trashScore: region.trashScore,
            hazardScore: region.hazardScore,
            noveltyScore: region.noveltyScore,
            stalenessScore: region.stalenessScore,
            score: region.score,
            scorePercent: Math.round(region.score * 100),
            risk: region.risk,
            riskPercent: Math.round(region.risk * 100),
            summary: region.summary,

            trashConcepts: [...region.trashConcepts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([concept, count]) => ({ concept, count })),

            hazardConcepts: [...region.hazardConcepts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([concept, count]) => ({ concept, count }))
        };
    }

    _regionCenter(region) {
        return {
            x: Math.floor((region.minX + region.maxX) / 2),
            y: Math.floor((region.minY + region.maxY) / 2)
        };
    }

    _saturatingScore(value, scale) {
        return this._clamp(value / (value + scale));
    }

    _recordEvent(event) {
        this.recentEvents.push({
            ...event,
            time: Date.now()
        });

        if (this.recentEvents.length > this.config.maxRecentEvents) {
            this.recentEvents.shift();
        }
    }

    _clamp(value) {
        return Math.max(0, Math.min(1, value));
    }
}