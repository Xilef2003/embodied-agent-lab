import { CONFIG } from "./config.js";
import { World } from "./world/World.js";
import { Robot } from "./robot/Robot.js";
import { Brain } from "./brain/Brain.js";
import { Renderer } from "./ui/Renderer.js";

const canvas = document.getElementById("world");
const statsElement = document.getElementById("stats");
const logElement = document.getElementById("log");

const startPauseButton = document.getElementById("startPause");
const stepButton = document.getElementById("step");
const resetButton = document.getElementById("reset");
const speedInput = document.getElementById("speed");

let world;
let robot;
let brain;
let renderer;
let running = false;
let intervalId = null;
let currentSeed = CONFIG.initialSeed;

window.addEventListener("error", event => {
    showFatalError("JavaScript error", event.error || event.message);
});

window.addEventListener("unhandledrejection", event => {
    showFatalError("Unhandled promise rejection", event.reason);
});

function createSimulation(seed = currentSeed) {
    try {
        world = new World(CONFIG, seed);
        robot = new Robot(world.robotStart.x, world.robotStart.y, CONFIG);
        brain = new Brain(world.width, world.height);
        renderer = new Renderer(canvas, statsElement, logElement, CONFIG);

        const observation = robot.sense(world);

        brain.worldModel.update(observation);
        renderer.render(world, robot, brain);

        writeDebugLog([
            "[boot] Simulation gestartet.",
            `[boot] Welt: ${world.width}x${world.height}`,
            `[boot] Entities: ${world.entities.size}`,
            `[boot] Roboter: (${robot.x}, ${robot.y})`
        ]);
    } catch (error) {
        showFatalError("Fehler beim Starten der Simulation", error);
    }
}

function tick() {
    try {
        const observation = robot.sense(world);
        const action = brain.decide(robot, observation);
        const result = robot.execute(world, action);

        brain.learn(action, result, observation, robot);

        const environmentEvents = world.tickEnvironment(robot);
        brain.recordExternalEvents(environmentEvents, robot);

        renderer.render(world, robot, brain);

        if (robot.body.battery <= 0) {
            pause();
        }
    } catch (error) {
        pause();
        showFatalError("Fehler während tick()", error);
    }
}

function start() {
    if (running) return;

    running = true;
    startPauseButton.textContent = "Pause";

    intervalId = setInterval(tick, Number(speedInput.value));
}

function pause() {
    running = false;
    startPauseButton.textContent = "Start";

    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

function reset() {
    pause();
    currentSeed++;
    createSimulation(currentSeed);
}

function showFatalError(title, error) {
    const message = formatError(error);

    console.error(title, error);

    if (logElement) {
        logElement.textContent = [
            `[FATAL] ${title}`,
            "",
            message,
            "",
            "Das ist der echte Grund, warum die Welt nicht gerendert wird."
        ].join("\n");
    }

    if (statsElement) {
        statsElement.innerHTML = `
            <div class="metric">
                <strong>Fehler</strong>
                <span>${escapeHtml(title)}</span>
            </div>
            <div class="metric">
                <strong>Details</strong>
                <span style="white-space:pre-wrap">${escapeHtml(message)}</span>
            </div>
        `;
    }
}

function writeDebugLog(lines) {
    if (!logElement) return;

    logElement.textContent = lines.join("\n");
}

function formatError(error) {
    if (!error) return "Unbekannter Fehler.";

    if (error.stack) return error.stack;
    if (error.message) return error.message;

    return String(error);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

startPauseButton.addEventListener("click", () => {
    if (running) {
        pause();
    } else {
        start();
    }
});

stepButton.addEventListener("click", () => {
    if (running) pause();
    tick();
});

resetButton.addEventListener("click", reset);

speedInput.addEventListener("input", () => {
    if (!running) return;

    pause();
    start();
});

createSimulation();