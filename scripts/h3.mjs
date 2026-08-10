import { join } from "node:path";

import { deployGpuApp, deployWebApp, downloadModels } from "./deploy/app.mjs";
import {
  ensureProjectPython,
  modalEnvironment,
  ROOT,
  run,
} from "./lib/project.mjs";
import { prepareModal } from "./setup/modal.mjs";

const [command, ...forwardedArgs] = process.argv.slice(2);

async function setup() {
  const python = await prepareModal();
  await downloadModels(python);
  await deployGpuApp(python);
  await deployWebApp(python);
  console.log("");
  console.log("Setup complete. Run `npm run smoke` to generate a test video.");
}

async function modalSetup() {
  await prepareModal();
}

async function models() {
  const python = await prepareModal();
  await downloadModels(python);
}

async function deploy() {
  const python = await prepareModal();
  await deployWebApp(python);
}

async function deployGpu() {
  const python = await prepareModal();
  await deployGpuApp(python);
}

async function generate(args) {
  const python = await prepareModal();
  await run(
    python,
    ["-m", "modal", "run", "modal_services/h3.py", ...args],
    { env: modalEnvironment() },
  );
}

async function smoke(args) {
  await generate(
    args.length
      ? args
      : [
          "--prompt",
          "A cinematic lighthouse in a night storm. Audio: waves, wind, and distant thunder.",
          "--out",
          "outputs/minimax-h3-smoke.mp4",
        ],
  );
}

async function test() {
  const python = await ensureProjectPython();
  await run(python, ["-m", "compileall", "-q", "modal_services", "minimax_h3", "tests"], {
    env: modalEnvironment(),
  });
  await run(python, ["-m", "unittest", "discover", "-s", "tests", "-v"], {
    env: modalEnvironment(),
  });
  for (const file of [
    "scripts/h3.mjs",
    "scripts/lib/project.mjs",
    "scripts/setup/modal.mjs",
    "scripts/deploy/app.mjs",
    "scripts/deploy/rotate-web.mjs",
  ]) {
    await run(process.execPath, ["--check", join(ROOT, file)]);
  }
  await run(process.execPath, ["--test", join(ROOT, "scripts/deploy/rotate-web.test.mjs")]);
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["--prefix", join(ROOT, "frontend"), "test"]);
}

switch (command) {
  case "setup":
    await setup();
    break;
  case "modal-setup":
    await modalSetup();
    break;
  case "models":
    await models();
    break;
  case "deploy":
    await deploy();
    break;
  case "deploy-gpu":
    await deployGpu();
    break;
  case "smoke":
    await smoke(forwardedArgs);
    break;
  case "generate":
    await generate(forwardedArgs);
    break;
  case "test":
    await test();
    break;
  default:
    throw new Error(
      "Use one of: setup, modal-setup, models, deploy, deploy-gpu, generate, smoke, test",
    );
}
