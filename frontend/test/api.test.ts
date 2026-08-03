import assert from "node:assert/strict";
import test from "node:test";
import { parseJobStatus, parseSpecs } from "../src/lib/api/contracts";
import { buildCreateJobRequest } from "../src/lib/api/createJobRequest";
import { emptyPromptDocument } from "../src/lib/promptDocument";
import { asset, specs } from "./fixtures";

test("frames request derives geometry from the first uploaded frame", () => {
  const frame = asset("first", "image", 2);
  const body = buildCreateJobRequest({ mode: "frames", prompt: "move", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", firstFrame: frame, lastFrame: null }, specs);
  const config = JSON.parse(String(body.get("config")));
  assert.deepEqual({ width: config.width, height: config.height, source: config.geometry_source }, { width: 864, height: 480, source: "first_frame" });
  const uploaded = body.get("first_frame") as File;
  assert.deepEqual({ name: uploaded.name, type: uploaded.type, size: uploaded.size }, { name: frame.name, type: frame.type, size: frame.size });
});

test("references request preserves newest-to-oldest attachment order", () => {
  const newest = asset("new", "image", 2); const oldest = asset("old", "video", 1);
  const body = buildCreateJobRequest({ mode: "references", prompt: "use both", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", references: [newest, oldest] }, specs);
  const config = JSON.parse(String(body.get("config")));
  assert.deepEqual(config.references.map(({ id, kind, field }: Record<string, string>) => ({ id, kind, field })), [
    { id: "new", kind: "image", field: "attachment_0" }, { id: "old", kind: "video", field: "attachment_1" },
  ]);
});

test("the client rejects unsupported contracts and statuses", () => {
  assert.throws(() => parseSpecs({ ...specs, version: "2.0" }), /Unsupported H3 spec version/);
  assert.throws(() => parseJobStatus({ id: "job", status: "processing" }, "job"), /invalid job status/);
});
