import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const VENV_PYTHON =
  process.platform === "win32"
    ? join(ROOT, ".venv", "Scripts", "python.exe")
    : join(ROOT, ".venv", "bin", "python");

export function run(command, args, options = {}) {
  const { cwd = ROOT, env = {}, stdio = "inherit" } = options;
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio,
      windowsHide: true,
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

export function runCapture(command, args, options = {}) {
  const { cwd = ROOT, env = {} } = options;
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
      stdio: ["inherit", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun(output);
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

export async function runOptional(command, args, options = {}) {
  try {
    await run(command, args, { ...options, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function ensureProjectPython() {
  if (!existsSync(VENV_PYTHON)) {
    console.log("Creating the local Python environment...");
    await run(process.env.PYTHON || "python", ["-m", "venv", ".venv"]);
  }
  const ready = await runOptional(VENV_PYTHON, [
    "-c",
    "import fastapi, httpx2, modal, multipart; assert modal.__version__ == '1.5.3'",
  ]);
  if (ready) return VENV_PYTHON;
  await run(VENV_PYTHON, [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "modal==1.5.3",
    "fastapi==0.141.1",
    "python-multipart==0.0.32",
    "httpx2==2.7.0",
  ]);
  return VENV_PYTHON;
}

export function modalEnvironment() {
  return {
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
}
