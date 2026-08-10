import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  modalEnvironment,
  ROOT,
  run,
  runCapture,
} from "../lib/project.mjs";
import {
  deployedWebUrl,
  expectedBundleName,
  rotateWebContainers,
  verifyFrontendBundle,
} from "./rotate-web.mjs";

async function buildFrontend() {
  const frontend = join(ROOT, "frontend");
  if (!existsSync(join(frontend, "package.json"))) {
    console.log("No frontend/package.json found; deploying the API without static assets.");
    return;
  }
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  if (!existsSync(join(frontend, "node_modules"))) {
    const install = existsSync(join(frontend, "package-lock.json")) ? "ci" : "install";
    await run(npm, ["--prefix", "frontend", install]);
  }
  console.log("Building the Vite frontend for the Modal web image...");
  await run(npm, ["--prefix", "frontend", "run", "build"]);
}

export async function downloadModels(python) {
  console.log("Downloading the pinned MiniMax H3 FL2VA + Ref2VA weights (~94 GiB)...");
  await run(
    python,
    ["-m", "modal", "run", "modal_services/h3_gpu.py::download_models"],
    { env: modalEnvironment() },
  );
}

export async function deployGpuApp(python) {
  console.log("Deploying the MiniMax H3 GPU worker...");
  await run(
    python,
    ["-m", "modal", "deploy", "modal_services/h3_gpu.py"],
    { env: modalEnvironment() },
  );
}

export async function deployWebApp(python) {
  await buildFrontend();
  const expectedBundle = expectedBundleName(join(ROOT, "frontend", "dist", "index.html"));
  console.log("Deploying the H3Zero gateway and compiled frontend...");
  const output = await runCapture(
    python,
    ["-m", "modal", "deploy", "modal_services/h3.py"],
    { env: modalEnvironment() },
  );
  await rotateWebContainers(python, modalEnvironment());
  if (expectedBundle) {
    const webUrl = deployedWebUrl(output);
    await verifyFrontendBundle(webUrl, expectedBundle);
  }
}
