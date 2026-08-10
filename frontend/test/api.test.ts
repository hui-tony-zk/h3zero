import assert from "node:assert/strict";
import test from "node:test";
import { parseJobStatus, parseSpecs } from "../src/lib/api/contracts";
import { buildCreateJobRequest } from "../src/lib/api/createJobRequest";
import { emptyPromptDocument, restoreReferenceTokens } from "../src/lib/promptDocument";
import { asset, specs } from "./fixtures";

test("frames request derives geometry from the first uploaded frame", () => {
  const frame = asset("first", "image", 2);
  const body = buildCreateJobRequest({ mode: "frames", prompt: "move", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 1, firstFrame: frame, lastFrame: null }, specs);
  const config = JSON.parse(String(body.get("config")));
  assert.deepEqual({ width: config.width, height: config.height, source: config.geometry_source }, { width: 864, height: 480, source: "first_frame" });
  assert.deepEqual({ steps: config.steps, sampler: config.sampler, scheduler: config.scheduler }, { steps: 8, sampler: "minimax_h3_turbo", scheduler: "simple" });
  const uploaded = body.get("first_frame") as File;
  assert.deepEqual({ name: uploaded.name, type: uploaded.type, size: uploaded.size }, { name: frame.name, type: frame.type, size: frame.size });
});

test("references request preserves upload order", () => {
  const first = asset("first", "image", 1); const second = asset("second", "video", 2);
  const body = buildCreateJobRequest({ mode: "references", prompt: "use both", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 1, references: [first, second] }, specs);
  const config = JSON.parse(String(body.get("config")));
  assert.deepEqual({ steps: config.steps, sampler: config.sampler, scheduler: config.scheduler }, { steps: 8, sampler: "minimax_h3_turbo", scheduler: "simple" });
  assert.deepEqual(config.references.map(({ id, kind, field }: Record<string, string>) => ({ id, kind, field })), [
    { id: "first", kind: "image", field: "attachment_0" }, { id: "second", kind: "video", field: "attachment_1" },
  ]);
});

test("reused reference labels submit as H3 picture tags", () => {
  const reference = asset("reelo-91732892");
  const prompt = restoreReferenceTokens("Animate reelo-91732892.png", [reference]);
  const body = buildCreateJobRequest({ mode: "references", prompt, promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 1, references: [reference] }, specs);
  assert.equal(body.get("prompt"), "Animate <Picture 1>");
});

test("the client rejects unsupported contracts and statuses", () => {
  assert.throws(() => parseSpecs({ ...specs, version: "2.0" }), /Unsupported H3 spec version/);
  assert.throws(() => parseJobStatus({ id: "job", status: "processing" }, "job"), /invalid job status/);
});
