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

function createSimulation(seed = currentSeed) {
    world = new World(CONFIG, seed);
    robot = new Robot(world.robotStart.x, world.robotStart.y, CONFIG);
    brain = new Brain(world.width, world.height);
    renderer = new Renderer(canvas, statsElement, logElement, CONFIG);

    const observation = robot.sense(world);
    brain.worldModel.update(observation);
    renderer.render(world, robot, brain);
}

function tick() {
    const observation = robot.sense(world);
    const action = brain.decide(robot, observation);
    const result = robot.execute(world, action);

    brain.learn(action, result, observation, robot);
    world.tickEnvironment(robot.position);

    renderer.render(world, robot, brain);

    if (robot.body.battery <= 0) {
        pause();
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
