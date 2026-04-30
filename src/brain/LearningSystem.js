export class LearningSystem {
    constructor() {
        this.episodes = [];
        this.stats = {
            successes: 0,
            failures: 0,
            collectedTrash: 0,
            emptiedTrash: 0
        };

        this.recentWindow = [];
    }

    learn(action, result, observation, robot) {
        const episode = {
            step: observation.step,
            position: { x: robot.x, y: robot.y },
            action,
            result,
            battery: robot.body.battery,
            trashLoad: robot.body.trashLoad
        };

        this.episodes.push(episode);
        if (this.episodes.length > 120) this.episodes.shift();

        this.recentWindow.push(Boolean(result?.ok));
        if (this.recentWindow.length > 12) this.recentWindow.shift();

        if (result?.ok) {
            this.stats.successes++;
        } else {
            this.stats.failures++;
        }

        if (result?.ok && result.type === "pickup") {
            this.stats.collectedTrash++;
        }

        if (result?.ok && result.type === "empty") {
            this.stats.emptiedTrash += result.emptied ?? 0;
        }

        return episode;
    }

    getState() {
        const recentFailures = this.recentWindow.filter(ok => !ok).length;
        const recentSuccesses = this.recentWindow.filter(Boolean).length;

        return {
            ...this.stats,
            recentFailures,
            recentSuccesses,
            recentWindow: [...this.recentWindow],
            lastEpisodes: this.episodes.slice(-8)
        };
    }

    getRecentLogLines(limit = 10) {
        return this.episodes.slice(-limit).map(episode => {
            const status = episode.result?.ok ? "OK" : "FAIL";
            const action = episode.action?.type || "none";
            const reason = episode.action?.reason || "";
            const message = episode.result?.message || "";

            return `[${episode.step}] ${status} ${action}: ${reason} -> ${message}`;
        });
    }
}
