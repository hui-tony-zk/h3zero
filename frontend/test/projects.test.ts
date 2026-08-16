import assert from "node:assert/strict";
import test from "node:test";
import { clipDuration, clipFractionAtSourceTime, isProjectPlaybackBoundary, makeProjectClip, moveProjectClip, normalizeClip, projectClipFadeDuration, projectClipOpacity, projectMembershipsByJob, reorderProjectClips, restoreProjects, sourceTimeAtClipFraction } from "../src/lib/projects";
import type { Job, LocalProject, ProjectClip } from "../src/types";

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

test("project playhead maps trimmed clip positions in both directions", () => {
  const trimmed = { ...clip("seek", 0), inPoint: 1, outPoint: 5, sourceDuration: 8 };
  assert.equal(sourceTimeAtClipFraction(trimmed, 0.5), 3);
  assert.equal(clipFractionAtSourceTime(trimmed, 3), 0.5);
  assert.equal(sourceTimeAtClipFraction(trimmed, -1), 1);
  assert.equal(clipFractionAtSourceTime(trimmed, 20), 1);
});

test("project playback preserves play intent at a clip boundary", () => {
  const trimmed = { ...clip("boundary", 0), outPoint: 4 };
  assert.equal(isProjectPlaybackBoundary(trimmed, 3.9), false);
  assert.equal(isProjectPlaybackBoundary(trimmed, 3.98), true);
  assert.equal(isProjectPlaybackBoundary(trimmed, 2, true), true);
});

test("project clips fade through black for half a second between clips", () => {
  const first = clip("first", 0);
  const middle = clip("middle", 1);
  assert.equal(projectClipFadeDuration(first, 0, 3), 0.5);
  assert.equal(projectClipOpacity(first, 0, 3, 4.75), 0.5);
  assert.equal(projectClipOpacity(first, 0, 3, 5), 0);
  assert.equal(projectClipOpacity(middle, 1, 3, 0), 0);
  assert.equal(projectClipOpacity(middle, 1, 3, 0.25), 0.5);
  assert.equal(projectClipOpacity(middle, 1, 3, 0.5), 1);
});

test("project fades shorten to fit very brief clips", () => {
  const brief = { ...clip("brief", 1), outPoint: 0.25, sourceDuration: 0.25, playbackRate: 2 };
  const fade = projectClipFadeDuration(brief, 1, 3, 30);
  assert.ok(fade > 0);
  assert.ok(fade < 0.05);
  assert.equal(projectClipOpacity(brief, 1, 3, 0), 0);
  assert.equal(projectClipOpacity(brief, 1, 3, 0.125), 1);
  assert.equal(projectClipOpacity(brief, 1, 3, 0.25), 0);
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
  const projectClip = makeProjectClip(job, 0);
  assert.equal(projectClip.outPoint, 15);
  assert.equal(projectClip.jobId, job.id);
  assert.equal("contentUrl" in projectClip, false);
  assert.equal("hearted" in projectClip, false);
});

test("project memberships group project chips by referenced job", () => {
  const project = (id: string, name: string, clips: ProjectClip[]): LocalProject => ({
    schemaVersion: 1,
    id,
    name,
    createdAt: 1,
    updatedAt: 1,
    aspect: "16:9",
    clips,
  });
  const memberships = projectMembershipsByJob([
    project("one", "Opening", [{ ...clip("a", 0), jobId: "shared" }]),
    project("two", "Final cut", [{ ...clip("b", 0), jobId: "shared" }, { ...clip("c", 1), jobId: "solo" }]),
  ]);
  assert.deepEqual(memberships.get("shared"), [{ id: "one", name: "Opening" }, { id: "two", name: "Final cut" }]);
  assert.deepEqual(memberships.get("solo"), [{ id: "two", name: "Final cut" }]);
});
