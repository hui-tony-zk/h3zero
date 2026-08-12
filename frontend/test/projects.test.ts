import assert from "node:assert/strict";
import test from "node:test";
import { clipDuration, makeProjectClip, moveProjectClip, normalizeClip, reorderProjectClips, restoreProjects } from "../src/lib/projects";
import type { Job, ProjectClip } from "../src/types";

const clip = (id: string, order: number): ProjectClip => ({
  id,
  jobId: `job-${id}`,
  inPoint: 0,
  outPoint: 5,
  sourceDuration: 5,
  playbackRate: 1,
  order,
  createdAt: 1,
});

test("project clips reorder by drag target and retain dense order values", () => {
  const clips = [clip("a", 0), clip("b", 1), clip("c", 2)];
  const reordered = reorderProjectClips(clips, "a", "c");
  assert.deepEqual(reordered.map(({ id }) => id), ["b", "c", "a"]);
  assert.deepEqual(reordered.map(({ order }) => order), [0, 1, 2]);
  assert.deepEqual(moveProjectClip(reordered, "a", -1).map(({ id }) => id), ["b", "a", "c"]);
});

test("clip edits stay within the source duration", () => {
  const normalized = normalizeClip({ ...clip("trim", 0), inPoint: 9, outPoint: 30, sourceDuration: 10, playbackRate: 9 });
  assert.equal(normalized.inPoint, 9);
  assert.equal(normalized.outPoint, 10);
  assert.equal(normalized.playbackRate, 1);
  assert.equal(clipDuration({ ...normalized, playbackRate: 2 }), 0.5);
});

test("project restore rejects unsupported records and normalizes clip order", () => {
  const restored = restoreProjects([
    { schemaVersion: 99, id: "future", clips: [] },
    {
      schemaVersion: 1,
      id: "project-one",
      name: "Sequence",
      createdAt: 10,
      updatedAt: 20,
      aspect: "9:16",
      clips: [{ ...clip("second", 7), order: 7 }, { ...clip("first", 3), order: 3 }],
    },
  ]);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].aspect, "9:16");
  assert.deepEqual(restored[0].clips.map(({ order }) => order), [0, 1]);
});

test("new project clips use canonical H3 output duration", () => {
  const job = {
    id: "a".repeat(32),
    mode: "frames",
    prompt: "test",
    createdAt: 1,
    updatedAt: 1,
    status: "completed",
    duration: 5,
    aspect: "16:9",
    turbo: true,
    inputAssetIds: [],
    contentUrl: "/api/video",
    metadata: { duration_seconds: 15 },
  } satisfies Job;
  assert.equal(makeProjectClip(job, 0).outPoint, 15);
});
