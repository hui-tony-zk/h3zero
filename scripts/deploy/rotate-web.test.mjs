import assert from "node:assert/strict";
import test from "node:test";

import {
  containerRole,
  deployedWebUrl,
  parseContainerList,
  rotateWebContainers,
  verifyFrontendBundle,
} from "./rotate-web.mjs";

test("parses Modal containers and function roles", () => {
  const containers = parseContainerList('[{"container_id":"ta-web","app_name":"minimax-h3"}]');
  assert.equal(containers[0].container_id, "ta-web");
  assert.equal(containerRole("Modal exec attached\nweb\n"), "web");
  assert.equal(containerRole("H3Service.generate\n"), "H3Service.generate");
});

test("extracts the web URL from rich Modal deployment output", () => {
  assert.equal(
    deployedWebUrl("web =>\nhttps://owner--minimax-h3-web.modal.run\n"),
    "https://owner--minimax-h3-web.modal.run",
  );
});

test("rotation stops only web containers and uses graceful stop", async () => {
  const calls = [];
  const containers = [
    { container_id: "ta-web", app_name: "minimax-h3" },
    { container_id: "ta-gpu", app_name: "minimax-h3" },
  ];
  const stopped = await rotateWebContainers("python", {}, {
    list: async () => containers,
    identify: async (_python, id) => id === "ta-web" ? "web" : "H3Service.generate",
    stop: async (_python, args) => calls.push(args),
  });
  assert.equal(stopped, 1);
  assert.deepEqual(calls, [[
    "-m", "modal", "container", "stop", "--graceful", "--yes", "ta-web",
  ]]);
});

test("frontend verification requires consecutive expected bundles", async () => {
  const bundles = ["old.js", "index-new.js", "index-new.js", "index-new.js"];
  let calls = 0;
  await verifyFrontendBundle("https://example.modal.run", "index-new.js", {
    fetchImpl: async () => ({
      ok: true,
      text: async () => `<script src="/assets/${bundles[calls++]}"></script>`,
    }),
    attempts: 4,
    consecutiveRequired: 3,
    delayMs: 0,
  });
  assert.equal(calls, 4);
});
