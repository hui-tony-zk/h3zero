import { readFileSync } from "node:fs";

import { run, runCapture } from "../lib/project.mjs";

const APP_NAME = "minimax-h3";
const WEB_ROLE = "web";
const ROLE_PROBE = [
  "import base64,json,os",
  "token=os.environ.get('MODAL_IDENTITY_TOKEN','')",
  "segment=token.split('.')[1] if token.count('.')>=2 else ''",
  "payload=json.loads(base64.urlsafe_b64decode(segment+'='*(-len(segment)%4))) if segment else {}",
  "print(os.environ.get('H3_CONTAINER_ROLE') or payload.get('function_name',''))",
].join("; ");

export function parseContainerList(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Modal container list did not return JSON");
  const parsed = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("Modal container list was not an array");
  return parsed;
}

export function containerRole(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.includes(WEB_ROLE)) return WEB_ROLE;
  return lines.findLast((line) => line === WEB_ROLE || /^[A-Za-z][A-Za-z0-9_.-]*$/.test(line)) || "";
}

export function expectedBundleName(indexPath) {
  try {
    const html = readFileSync(indexPath, "utf8");
    return html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1] || "";
  } catch {
    return "";
  }
}

export function deployedWebUrl(output) {
  const urls = output.match(/https:\/\/[^\s\x1b]+\.modal\.run/g) || [];
  const webUrl = urls.find((url) => /-web\.modal\.run$/.test(url));
  if (!webUrl) throw new Error("Could not read the deployed web URL from Modal output");
  return webUrl;
}

async function listAppContainers(python, env) {
  const output = await runCapture(
    python,
    ["-m", "modal", "container", "list", "--json"],
    { env },
  );
  return parseContainerList(output).filter((container) => container.app_name === APP_NAME);
}

async function identifyRole(python, containerId, env) {
  const output = await runCapture(
    python,
    [
      "-m", "modal", "container", "exec", "--no-pty", containerId,
      "--", "python3", "-c", ROLE_PROBE,
    ],
    { env },
  );
  return containerRole(output);
}

export async function rotateWebContainers(
  python,
  env,
  { list = listAppContainers, identify = identifyRole, stop = run } = {},
) {
  const containers = await list(python, env);
  let stopped = 0;
  for (const container of containers) {
    const id = container.container_id;
    let role;
    try {
      role = await identify(python, id, env);
    } catch (error) {
      const remaining = await list(python, env);
      if (!remaining.some((candidate) => candidate.container_id === id)) continue;
      throw new Error(`Refusing to stop unclassified container ${id}: ${error.message}`);
    }
    if (role !== WEB_ROLE) {
      console.log(`Preserving Modal container ${id} (role: ${role || "unknown"}).`);
      continue;
    }
    console.log(`Gracefully rotating stale web container ${id}...`);
    try {
      await stop(
        python,
        ["-m", "modal", "container", "stop", "--graceful", "--yes", id],
        { env },
      );
      stopped += 1;
    } catch (error) {
      const remaining = await list(python, env);
      if (remaining.some((candidate) => candidate.container_id === id)) throw error;
    }
  }
  console.log(`Web container rotation complete (${stopped} stopped; GPU containers preserved).`);
  return stopped;
}

export async function verifyFrontendBundle(
  webUrl,
  expectedBundle,
  { fetchImpl = fetch, attempts = 12, consecutiveRequired = 3, delayMs = 1000 } = {},
) {
  let consecutive = 0;
  let lastBundle = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const separator = webUrl.includes("?") ? "&" : "?";
    const response = await fetchImpl(`${webUrl}/${separator}deploy_verify=${Date.now()}-${attempt}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Frontend verification returned HTTP ${response.status}`);
    const html = await response.text();
    lastBundle = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1] || "";
    consecutive = lastBundle === expectedBundle ? consecutive + 1 : 0;
    if (consecutive >= consecutiveRequired) {
      console.log(`Verified ${expectedBundle} on ${webUrl} (${consecutiveRequired} consecutive requests).`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    `Deployed frontend did not stabilize on ${expectedBundle}; last response used ${lastBundle || "no bundle"}`,
  );
}
