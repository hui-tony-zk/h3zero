import {
  ensureProjectPython,
  modalEnvironment,
  run,
  runOptional,
} from "../lib/project.mjs";

const VOLUMES = ["comfy-ui-models", "minimax-h3-outputs"];

export async function prepareModal() {
  const python = await ensureProjectPython();
  if (!(await runOptional(python, ["-m", "modal", "profile", "current"]))) {
    console.log("Modal is not authenticated yet. Opening Modal setup...");
    await run(python, ["-m", "modal", "setup"], { env: modalEnvironment() });
  }

  for (const volume of VOLUMES) {
    await runOptional(python, ["-m", "modal", "volume", "create", volume], {
      env: modalEnvironment(),
    });
  }

  console.log("Modal auth plus model/output Volumes are ready.");
  return python;
}
