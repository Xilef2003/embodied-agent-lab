import { ENTITY } from "../config.js";
import { keyOf } from "../utils/Grid.js";

const COLORS = {
    background: "#e5e7eb",
    grid: "#cbd5e1",
    unknown: "rgba(15, 23, 42, 0.30)",
    known: "rgba(255, 255, 255, 0.22)",
    sensor: "rgba(37, 99, 235, 0.10)",

    robot: "#2563eb",
    trash: "#22c55e",
    obstacle: "#374151",
    charger: "#f59e0b",
    human: "#a855f7",
    animal: "#ef4444"
};

export class Renderer {
    constructor(canvas, statsElement, logElement, config) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.statsElement = statsElement;
        this.logElement = logElement;
        this.config = config;

        this.cellW = canvas.width / config.gridWidth;
        this.cellH = canvas.height / config.gridHeight;
    }

    render(world, robot, brain) {
        const brainState = brain.getState();
        this._drawWorld(world, robot, brain);
        this._renderStats(world, robot, brainState);
        this._renderLog(brainState.recentLogLines);
    }

    _drawWorld(world, robot, brain) {
        const ctx = this.ctx;

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.fillStyle = COLORS.background;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this._drawKnownOverlay(world, brain);
        this._drawSensorRange(robot);
        this._drawGrid(world);

        for (const entity of world.entities.values()) {
            this._drawEntity(entity);
        }

        this._drawRobot(robot);
    }

    _drawKnownOverlay(world, brain) {
        const ctx = this.ctx;
        const knownCells = brain.worldModel.knownCells;

        for (let y = 0; y < world.height; y++) {
            for (let x = 0; x < world.width; x++) {
                const key = keyOf(x, y);
                ctx.fillStyle = knownCells.has(key) ? COLORS.known : COLORS.unknown;
                ctx.fillRect(x * this.cellW, y * this.cellH, this.cellW, this.cellH);
            }
        }
    }

    _drawSensorRange(robot) {
        const ctx = this.ctx;
        const radius = robot.sensorRange;

        ctx.fillStyle = COLORS.sensor;

        for (let y = robot.y - radius; y <= robot.y + radius; y++) {
            for (let x = robot.x - radius; x <= robot.x + radius; x++) {
                const distance = Math.max(Math.abs(x - robot.x), Math.abs(y - robot.y));
                if (distance > radius) continue;

                ctx.fillRect(x * this.cellW, y * this.cellH, this.cellW, this.cellH);
            }
        }
    }

    _drawGrid(world) {
        const ctx = this.ctx;

        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 0.7;

        for (let x = 0; x <= world.width; x++) {
            ctx.beginPath();
            ctx.moveTo(x * this.cellW, 0);
            ctx.lineTo(x * this.cellW, this.canvas.height);
            ctx.stroke();
        }

        for (let y = 0; y <= world.height; y++) {
            ctx.beginPath();
            ctx.moveTo(0, y * this.cellH);
            ctx.lineTo(this.canvas.width, y * this.cellH);
            ctx.stroke();
        }
    }

    _drawEntity(entity) {
        const ctx = this.ctx;
        const cx = entity.x * this.cellW + this.cellW / 2;
        const cy = entity.y * this.cellH + this.cellH / 2;
        const r = Math.min(this.cellW, this.cellH) * 0.34;

        const color = {
            [ENTITY.TRASH]: COLORS.trash,
            [ENTITY.OBSTACLE]: COLORS.obstacle,
            [ENTITY.CHARGER]: COLORS.charger,
            [ENTITY.HUMAN]: COLORS.human,
            [ENTITY.ANIMAL]: COLORS.animal
        }[entity.type] || "#64748b";

        ctx.fillStyle = color;

        if (entity.type === ENTITY.OBSTACLE) {
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            return;
        }

        if (entity.type === ENTITY.CHARGER) {
            ctx.beginPath();
            ctx.moveTo(cx, cy - r);
            ctx.lineTo(cx + r, cy);
            ctx.lineTo(cx, cy + r);
            ctx.lineTo(cx - r, cy);
            ctx.closePath();
            ctx.fill();
            return;
        }

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }

    _drawRobot(robot) {
        const ctx = this.ctx;
        const cx = robot.x * this.cellW + this.cellW / 2;
        const cy = robot.y * this.cellH + this.cellH / 2;
        const r = Math.min(this.cellW, this.cellH) * 0.42;

        ctx.fillStyle = COLORS.robot;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "white";
        ctx.font = "bold 13px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("R", cx, cy);
    }

    _renderStats(world, robot, state) {
        const goal = state.goal;
        const action = state.action;
        const needs = state.needs || {};
        const emotions = state.emotions || {};
        const semantic = state.semantic || {};

        const topSemanticTarget = semantic.collectableTargets?.[0];
        const topHazard = semantic.hazards?.[0];

        this.statsElement.innerHTML = `
            ${metric("Tick", world.step)}
            ${metric("Akku", `${robot.body.battery.toFixed(1)}% ${bar(robot.body.batteryRatio)}`)}
            ${metric("Müllbehälter", `${robot.body.trashLoad}/${robot.body.maxTrashLoad} ${bar(robot.body.loadRatio)}`)}
            ${metric("Gesammelt", robot.body.totalCollected)}
            ${metric("Abgegeben", robot.body.totalEmptied)}
            ${metric("Ziel", `${escapeHtml(goal?.type || "-")}<br><span style="color:#6b7280">${escapeHtml(goal?.reason || "")}</span>`)}
            ${metric("Aktion", `${escapeHtml(action?.type || "-")}<br><span style="color:#6b7280">${escapeHtml(action?.reason || "")}</span>`)}
            ${metric("Aktive Entscheidung", formatActiveDecision(goal?.explanation))}
            ${metric("Bekannte Welt", `${Math.round((state.knownCellsRatio || 0) * 100)}% ${bar(state.knownCellsRatio || 0)}`)}
            ${metric("Bekannter Müll", state.knownTrashCount)}
            ${metric("Sem. Sammelziele", state.semanticCollectableCount)}
            ${metric("Sem. Risiken", state.semanticHazardCount)}
            ${metric("Relationen", state.relationCount)}
            ${metric("Affordances", state.affordanceCount)}
            ${metric("Lernereignisse", state.experienceEventCount)}
            ${metric("Erfahrungsprofile", state.experienceConceptCount)}
            ${metric("Strategisches Sammelziel", formatTopUtilityTarget(topSemanticTarget))}
            ${metric("Sammelziel-Erklärung", formatDecisionExplanation(state.decisionExplanation))}
            ${metric("Utility-Ranking", formatUtilityRanking(state.utilityRankedTargets || []))}
            ${metric("Nächstes Risiko", topHazard ? `${escapeHtml(topHazard.label)}<br><span style="color:#6b7280">${escapeHtml(topHazard.concept)} → keep_distance</span>` : "-")}
            ${metric("Gelerntes Wissen", formatExperienceProfiles(state.experienceProfiles || []))}
            ${metric("Home bekannt", state.homeKnown ? "ja" : "nein")}
            ${metric("Bedürfnisse", formatMap(needs))}
            ${metric("Emotionen", formatMap(emotions))}
        `;
    }

    _renderLog(lines) {
        this.logElement.textContent = lines.join("\n");
        this.logElement.scrollTop = this.logElement.scrollHeight;
    }
}

function metric(label, value) {
    return `
        <div class="metric">
            <strong>${label}</strong>
            <span>${value}</span>
        </div>
    `;
}

function bar(value) {
    const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
    return `<div class="bar"><span style="width:${pct}%"></span></div>`;
}

function formatActiveDecision(explanation) {
    if (!explanation) return "-";

    const evidence = explanation.evidence?.length
        ? explanation.evidence.map(item => `<li>${escapeHtml(item)}</li>`).join("")
        : "<li>-</li>";

    const suppressed = explanation.suppressedGoals?.length
        ? explanation.suppressedGoals.map(goal => `
            <li>
                <strong>${escapeHtml(goal.label)}</strong>:
                <span style="color:#6b7280">${escapeHtml(goal.reason)}</span>
            </li>
        `).join("")
        : "<li>Keine relevanten unterdrückten Ziele.</li>";

    return `
        <div style="margin-bottom:8px">
            <strong>${escapeHtml(explanation.title)}</strong>
            <br>
            <span style="color:#6b7280">${escapeHtml(explanation.summary)}</span>
        </div>

        <div style="margin-bottom:8px">
            <strong>Belege</strong>
            <ul style="margin:4px 0 0 18px; padding:0">${evidence}</ul>
        </div>

        <div>
            <strong>Unterdrückte Ziele</strong>
            <ul style="margin:4px 0 0 18px; padding:0">${suppressed}</ul>
        </div>
    `;
}

function formatTopUtilityTarget(target) {
    if (!target) return "-";

    return `
        ${escapeHtml(target.label)}
        <br>
        <span style="color:#6b7280">
            ${escapeHtml(target.concept)} · Utility ${target.utility?.scorePercent ?? "?"}%
        </span>
        <br>
        <span style="color:#6b7280">
            ${escapeHtml(target.utility?.explanation || "")}
        </span>
    `;
}

function formatDecisionExplanation(explanation) {
    if (!explanation || !explanation.selected) {
        return explanation?.summary ? escapeHtml(explanation.summary) : "-";
    }

    const selected = explanation.selected;
    const breakdown = selected.breakdown || [];

    const plus = breakdown.filter(item => item.direction === "plus");
    const minus = breakdown.filter(item => item.direction === "minus");
    const neutral = breakdown.filter(item => item.direction === "neutral");

    return `
        <div style="margin-bottom:8px">
            <strong>${escapeHtml(explanation.title)}</strong>
            <br>
            <span style="color:#6b7280">${escapeHtml(explanation.summary)}</span>
        </div>

        <div style="margin-bottom:8px">
            <strong>Plus-Faktoren</strong>
            ${formatFactorList(plus, "plus")}
        </div>

        <div style="margin-bottom:8px">
            <strong>Minus-Faktoren</strong>
            ${formatFactorList(minus, "minus")}
        </div>

        <div>
            <strong>Neutrale Faktoren</strong>
            ${formatFactorList(neutral, "neutral")}
        </div>
    `;
}

function formatFactorList(items, direction) {
    if (!items || items.length === 0) {
        return `<br><span style="color:#6b7280">-</span>`;
    }

    const symbol = {
        plus: "+",
        minus: "-",
        neutral: "·"
    }[direction] || "·";

    return items.map(item => {
        const contribution = Math.round(Math.abs((item.contribution || 0) * 100));

        return `
            <div style="margin-top:4px">
                <span style="font-weight:700">${symbol} ${escapeHtml(item.label)}</span>
                <span style="color:#6b7280">(${contribution} Punkte)</span>
                <br>
                <span style="color:#6b7280">${escapeHtml(item.text || "")}</span>
            </div>
        `;
    }).join("");
}

function formatUtilityRanking(targets) {
    if (!targets || targets.length === 0) {
        return "-";
    }

    return targets.slice(0, 4).map((target, index) => {
        const utility = target.utility;
        const strongestMinus = utility?.breakdown
            ?.filter(item => item.direction === "minus")
            ?.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
            ?.[0];

        const minusText = strongestMinus
            ? `<br><span style="color:#b45309">Minus: ${escapeHtml(strongestMinus.label)} - ${escapeHtml(strongestMinus.text)}</span>`
            : "";

        return `
            <div style="margin-bottom:8px">
                <strong>${index + 1}. ${escapeHtml(target.label)}</strong>
                <br>
                <span style="color:#6b7280">
                    ${escapeHtml(target.concept)}
                    · ${utility?.scorePercent ?? "?"}%
                    · Distanz ${utility?.distanceToTarget ?? "?"}
                    · ${utility?.isEnergyViable ? "Akku ok" : "Akku knapp"}
                </span>
                ${minusText}
            </div>
        `;
    }).join("");
}

function formatMap(map) {
    return Object.entries(map)
        .map(([key, value]) => `${escapeHtml(key)}: ${typeof value === "number" ? value.toFixed(2) : escapeHtml(String(value))}`)
        .join("<br>");
}

function formatExperienceProfiles(profiles) {
    if (!profiles || profiles.length === 0) {
        return "-";
    }

    return profiles.slice(0, 5).map(profile => {
        const rate = profile.pickupAttempts > 0
            ? `${Math.round((profile.pickupSuccessRate || 0) * 100)}%`
            : "-";

        const reliability = Math.round((profile.reliability || 0) * 100);

        const tags = profile.tags?.length
            ? `<br><span style="color:#6b7280">${profile.tags.slice(0, 4).map(escapeHtml).join(", ")}</span>`
            : "";

        return `
            <div style="margin-bottom:8px">
                <strong>${escapeHtml(profile.concept)}</strong>
                <br>
                Pickups: ${profile.pickupSuccess}/${profile.pickupAttempts}
                · Erfolg: ${rate}
                · Vertrauen: ${reliability}%
                ${tags}
            </div>
        `;
    }).join("");
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}