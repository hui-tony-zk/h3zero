import assert from "node:assert/strict";
import test from "node:test";
import { clipDuration, clipFractionAtSourceTime, isProjectPlaybackBoundary, makeProjectClip, moveProjectClip, normalizeClip, projectClipFadeDuration, projectClipOpacity, projectClipTrimValue, projectMembershipsByJob, reorderProjectClips, replaceProjectClip, restoreProjects, shouldToggleProjectPlayback, sourceTimeAtClipFraction, timelineEdgeScrollVelocity } from "../src/lib/projects";
import { resolveProjectPlaybackPosition } from "../src/lib/projectPlayback";
import type { Job, LocalProject, ProjectClip } from "../src/types";

const clip = (id: string, order: number): ProjectClip => ({
  id,
  jobId: `job-${id}`,
  inPoint: 0,
  outPoint: 5,
  sourceDuration: 5,
  playbackRate: 1,
  transitionIn: "fade-black",
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

test("project trim handles stay ordered and preserve the minimum clip length", () => {
  const trimmed = { ...clip("handles", 0), inPoint: 1, outPoint: 4, sourceDuration: 8 };
  assert.equal(projectClipTrimValue(trimmed, "start", -2), 0);
  assert.equal(projectClipTrimValue(trimmed, "start", 7), 3.75);
  assert.equal(projectClipTrimValue(trimmed, "end", 0), 1.25);
  assert.equal(projectClipTrimValue(trimmed, "end", 20), 8);
});

test("project playhead maps trimmed clip positions in both directions", () => {
  const trimmed = { ...clip("seek", 0), inPoint: 1, outPoint: 5, sourceDuration: 8 };
  assert.equal(sourceTimeAtClipFraction(trimmed, 0.5), 3);
  assert.equal(clipFractionAtSourceTime(trimmed, 3), 0.5);
  assert.equal(sourceTimeAtClipFraction(trimmed, -1), 1);
  assert.equal(clipFractionAtSourceTime(trimmed, 20), 1);
});

test("project playback restores a valid per-project timeline position", () => {
  const clips = [{ ...clip("first", 0), inPoint: 1, outPoint: 4 }, { ...clip("second", 1), inPoint: 2, outPoint: 5 }];
  assert.deepEqual(resolveProjectPlaybackPosition(clips, { clipId: "second", sourceTime: 4.25 }), { clipId: "second", sourceTime: 4.25 });
  assert.deepEqual(resolveProjectPlaybackPosition(clips, { clipId: "second", sourceTime: 20 }), { clipId: "second", sourceTime: 5 });
  assert.deepEqual(resolveProjectPlaybackPosition(clips, { clipId: "missing", sourceTime: 3 }), { clipId: "first", sourceTime: 1 });
  assert.equal(resolveProjectPlaybackPosition([], { clipId: "first", sourceTime: 2 }), null);
});

test("timeline edge scrolling accelerates toward either viewport edge", () => {
  assert.equal(timelineEdgeScrollVelocity(500, 100, 900), 0);
  assert.equal(timelineEdgeScrollVelocity(100, 100, 900), -18);
  assert.equal(timelineEdgeScrollVelocity(900, 100, 900), 18);
  assert.equal(timelineEdgeScrollVelocity(136, 100, 900), -9);
  assert.equal(timelineEdgeScrollVelocity(864, 100, 900), 9);
});

test("project playback preserves play intent at a clip boundary", () => {
  const trimmed = { ...clip("boundary", 0), outPoint: 4 };
  assert.equal(isProjectPlaybackBoundary(trimmed, 3.9), false);
  assert.equal(isProjectPlaybackBoundary(trimmed, 3.98), true);
  assert.equal(isProjectPlaybackBoundary(trimmed, 2, true), true);
});

test("space toggles project playback without stealing interactive controls", () => {
  const event = (overrides: Record<string, unknown> = {}) => ({
    altKey: false,
    code: "Space",
    ctrlKey: false,
    defaultPrevented: false,
    key: " ",
    metaKey: false,
    repeat: false,
    shiftKey: false,
    target: { closest: () => null },
    ...overrides,
  });
  assert.equal(shouldToggleProjectPlayback(event()), true);
  assert.equal(shouldToggleProjectPlayback(event({ repeat: true })), false);
  assert.equal(shouldToggleProjectPlayback(event({ metaKey: true })), false);
  assert.equal(shouldToggleProjectPlayback(event({ code: "Enter", key: "Enter" })), false);
  assert.equal(shouldToggleProjectPlayback(event({
    target: { closest: (selector: string) => selector.includes("input") ? ({ tagName: "INPUT" }) : null },
  })), false);
  assert.equal(shouldToggleProjectPlayback(event({
    target: { closest: (selector: string) => selector === "[data-project-timeline]" ? ({ dataset: { projectTimeline: "" } }) : ({ tagName: "BUTTON" }) },
  })), true);
});

test("project clips fade through black for 0.3 seconds between clips", () => {
  const first = clip("first", 0);
  const middle = clip("middle", 1);
  const last = clip("last", 2);
  const clips = [first, middle, last];
  assert.equal(projectClipFadeDuration(clips, 0), 0.3);
  assert.ok(Math.abs(projectClipOpacity(clips, 0, 4.85) - 0.5) < 1e-9);
  assert.equal(projectClipOpacity(clips, 0, 5), 0);
  assert.equal(projectClipOpacity(clips, 1, 0), 0);
  assert.equal(projectClipOpacity(clips, 1, 0.15), 0.5);
  assert.equal(projectClipOpacity(clips, 1, 0.3), 1);
});

test("project fades shorten to fit very brief clips", () => {
  const brief = { ...clip("brief", 1), outPoint: 0.25, sourceDuration: 0.25, playbackRate: 2 };
  const clips = [clip("first", 0), brief, clip("last", 2)];
  const fade = projectClipFadeDuration(clips, 1, 30);
  assert.ok(fade > 0);
  assert.ok(fade < 0.05);
  assert.equal(projectClipOpacity(clips, 1, 0), 0);
  assert.equal(projectClipOpacity(clips, 1, 0.125), 1);
  assert.equal(projectClipOpacity(clips, 1, 0.25), 0);
});

test("project transitions can use a hard cut at an individual boundary", () => {
  const first = clip("first", 0);
  const middle = { ...clip("middle", 1), transitionIn: "cut" as const };
  const last = clip("last", 2);
  const clips = [first, middle, last];
  assert.equal(projectClipOpacity(clips, 0, 5), 1);
  assert.equal(projectClipOpacity(clips, 1, 0), 1);
  assert.equal(projectClipOpacity(clips, 1, 5), 0);
  assert.equal(projectClipOpacity(clips, 2, 0), 0);
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
  assert.deepEqual(restored[0].clips.map(({ transitionIn }) => transitionIn), ["fade-black", "fade-black"]);
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
  assert.equal(projectClip.transitionIn, "fade-black");
  assert.equal("contentUrl" in projectClip, false);
  assert.equal("hearted" in projectClip, false);
});

test("replacing a project clip resets source trim while preserving sequence edits", () => {
  const original = {
    ...clip("replace", 3),
    inPoint: 1.5,
    outPoint: 4,
    playbackRate: 1.5 as const,
    transitionIn: "cut" as const,
    createdAt: 42,
  };
  const replacementJob = {
    id: "b".repeat(32),
    mode: "frames",
    prompt: "replacement",
    createdAt: 2,
    updatedAt: 2,
    status: "completed",
    duration: 5,
    aspect: "16:9",
    turbo: true,
    inputAssetIds: [],
    contentUrl: "/api/replacement-video",
    metadata: { duration_seconds: 15 },
  } satisfies Job;

  const replaced = replaceProjectClip(original, replacementJob);
  assert.equal(replaced.id, original.id);
  assert.equal(replaced.jobId, replacementJob.id);
  assert.equal(replaced.inPoint, 0);
  assert.equal(replaced.outPoint, 15);
  assert.equal(replaced.sourceDuration, 15);
  assert.equal(replaced.playbackRate, 1.5);
  assert.equal(replaced.transitionIn, "cut");
  assert.equal(replaced.order, 3);
  assert.equal(replaced.createdAt, 42);
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
