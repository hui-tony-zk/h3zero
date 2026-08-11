import assert from "node:assert/strict";
import test from "node:test";
import { parseJobStatus, parseSpecs } from "../src/lib/api/contracts";
import { buildCreateJobRequest } from "../src/lib/api/createJobRequest";
import { emptyPromptDocument, restoreReferenceTokens } from "../src/lib/promptDocument";
import { asset, specs } from "./fixtures";
import { deleteJob } from "../src/lib/api/client";

test("frames request derives geometry from the first uploaded frame", () => {
  const frame = asset("first", "image", 2);
  const body = buildCreateJobRequest({ mode: "frames", prompt: "move", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 1, turbo: true, firstFrame: frame, lastFrame: null }, specs);
  const config = JSON.parse(String(body.get("config")));
  assert.deepEqual({ width: config.width, height: config.height, source: config.geometry_source }, { width: 864, height: 480, source: "first_frame" });
  assert.deepEqual({ profile: config.sampling_profile, turbo: config.turbo, seed: config.seed, resolution: config.resolution, steps: config.steps, sampler: config.sampler, scheduler: config.scheduler }, { profile: "turbo_4", turbo: true, seed: null, resolution: "480p", steps: 4, sampler: "res_multistep", scheduler: "simple" });
  const uploaded = body.get("first_frame") as File;
  assert.deepEqual({ name: uploaded.name, type: uploaded.type, size: uploaded.size }, { name: frame.name, type: frame.type, size: frame.size });
});

test("references request preserves upload order", () => {
  const first = asset("first", "image", 1); const second = asset("second", "video", 2);
  const body = buildCreateJobRequest({ mode: "references", prompt: "use both", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 1, turbo: true, references: [first, second] }, specs);
  const config = JSON.parse(String(body.get("config")));
  assert.deepEqual({ steps: config.steps, sampler: config.sampler, scheduler: config.scheduler }, { steps: 4, sampler: "res_multistep", scheduler: "simple" });
  assert.deepEqual(config.references.map(({ id, kind, field }: Record<string, string>) => ({ id, kind, field })), [
    { id: "first", kind: "image", field: "attachment_0" }, { id: "second", kind: "video", field: "attachment_1" },
  ]);
});

test("reused reference labels submit as H3 picture tags", () => {
  const reference = asset("reelo-91732892");
  const prompt = restoreReferenceTokens("Animate reelo-91732892.png", [reference]);
  const body = buildCreateJobRequest({ mode: "references", prompt, promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 1, turbo: true, references: [reference] }, specs);
  assert.equal(body.get("prompt"), "Animate <Picture 1>");
});

test("turning Turbo off selects Spectrum", () => {
  const body = buildCreateJobRequest({ mode: "frames", prompt: "move", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 1, turbo: false, firstFrame: null, lastFrame: null }, specs);
  const config = JSON.parse(String(body.get("config")));
  assert.deepEqual({ profile: config.sampling_profile, turbo: config.turbo, seed: config.seed, resolution: config.resolution, steps: config.steps, sampler: config.sampler, scheduler: config.scheduler }, { profile: "spectrum", turbo: false, seed: null, resolution: "480p", steps: 20, sampler: "res_multistep", scheduler: "simple" });
});

test("all profile choices retain random-seed 480p production settings", () => {
  for (const [draft, profile, steps, turbo] of [
    [{ mode: "frames", prompt: "compare", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 1, samplingProfile: "turbo_4", seed: 42, resolution: "768p", firstFrame: null, lastFrame: null }, "turbo_4", 4, true],
    [{ mode: "frames", prompt: "compare", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 1, samplingProfile: "turbo_8", seed: 42, resolution: "768p", firstFrame: null, lastFrame: null }, "turbo_8", 8, true],
    [{ mode: "frames", prompt: "compare", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 1, samplingProfile: "spectrum", seed: 106, resolution: "768p", firstFrame: null, lastFrame: null }, "spectrum", 20, false],
    [{ mode: "frames", prompt: "compare", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 1, samplingProfile: "base", seed: 99, resolution: "768p", firstFrame: asset("frame"), lastFrame: null }, "base", 20, false],
  ] as const) {
    const config = JSON.parse(String(buildCreateJobRequest(draft, specs).get("config")));
    assert.equal(config.sampling_profile, profile);
    assert.equal(config.steps, steps);
    assert.equal(config.turbo, turbo);
    assert.equal(config.seed, null);
    assert.equal(config.resolution, "480p");
    assert.equal(config.width, 864);
    assert.equal(config.height, 480);
  }
});

test("configured LoRA strengths are submitted by id", () => {
  const withLora = { ...specs, output: { ...specs.output, loras: [{
    id: "pose", name: "Pose", filename: "pose.safetensors", default_enabled: false,
    default_strength: 1, min_strength: 0, max_strength: 1.5, step: 0.1,
  }] } };
  const body = buildCreateJobRequest({ mode: "frames", prompt: "move", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 1, turbo: true, loras: { pose: 0.8 }, firstFrame: null, lastFrame: null }, withLora);
  assert.deepEqual(JSON.parse(String(body.get("config"))).loras, { pose: 0.8 });
});

test("the client rejects unsupported contracts and statuses", () => {
  assert.throws(() => parseSpecs({ ...specs, version: "2.0" }), /Unsupported H3 spec version/);
  assert.throws(() => parseJobStatus({ id: "job", status: "processing" }, "job"), /invalid job status/);
});

test("job status preserves the server sampling timestamp for generation timing", () => {
  const status = parseJobStatus({
    id: "job",
    status: "completed",
    created_at: "2026-08-11T16:00:00Z",
    sampling_started_at: "2026-08-11T16:00:30Z",
    updated_at: "2026-08-11T16:01:32Z",
  }, "job");
  assert.equal(status.updatedAt! - status.samplingStartedAt!, 62_000);
});

test("a deployment without configured LoRAs exposes no mixer entries", () => {
  const { loras: _loras, ...output } = specs.output;
  assert.deepEqual(parseSpecs({ ...specs, output }).output.loras, []);
});

test("deleting an already-missing job succeeds", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: "job not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
  try {
    await assert.doesNotReject(deleteJob("already-gone"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
