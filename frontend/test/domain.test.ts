import assert from "node:assert/strict";
import test from "node:test";
import { isGithubStarReminderMilestone } from "../src/lib/githubStarReminder";
import { groupJobs, pendingJob, sortJobs, uploadingJob } from "../src/lib/jobs";
import { emptyPromptDocument, hydratePromptDocument, promptDocumentToText, promptTextToDocument, prunePromptDocument, replaceReferenceInPromptDocument, restoreReferenceTokens } from "../src/lib/promptDocument";
import { PROMPT_SECTION_NODE } from "../src/lib/promptSections";
import { PROMPT_TASK_TYPE_NODE, removeLastPromptTaskType } from "../src/lib/promptTaskTypes";
import { hasReferencePromptContent, REFERENCE_PROMPT_STRUCTURE } from "../src/lib/promptDefaults";
import { buildReferenceInsertion } from "../src/lib/promptRecipes";
import { describeFavoriteAssets, mergeFavoriteSnapshot, parseFavoriteSnapshot } from "../src/lib/favorites";
import { normalizeCloudSyncUsername } from "../src/lib/cloudSync";
import { generationSettingSections } from "../src/lib/generationSettings";
import type { Job } from "../src/types";
import { emptyFramesDraft, emptyReferencesDraft } from "../src/lib/storage/draftRepository";
import { asset } from "./fixtures";

test("active jobs sort first, then newest to oldest", () => {
  const base = { mode: "frames", prompt: "", duration: 5, aspect: "16:9", displayAspect: 1, inputAssetIds: [], contentUrl: "" } as const;
  const jobs = [
    { ...base, id: "done", status: "completed", createdAt: 30, updatedAt: 30 },
    { ...base, id: "old-active", status: "running", createdAt: 10, updatedAt: 10 },
    { ...base, id: "new-active", status: "queued", createdAt: 20, updatedAt: 20 },
  ] as Job[];
  assert.deepEqual(sortJobs(jobs).map(({ id }) => id), ["new-active", "old-active", "done"]);
});

test("cloud favorites merge into local history without duplicating jobs", () => {
  const base = { mode: "frames", prompt: "local", duration: 5, aspect: "16:9", inputAssetIds: [], contentUrl: "" } as const;
  const local = [
    { ...base, id: "kept", status: "completed", createdAt: 30, updatedAt: 30, hearted: false, loras: { old: 0.4 } },
    { ...base, id: "stale", status: "completed", createdAt: 20, updatedAt: 20, hearted: true },
  ] as Job[];
  const remote = parseFavoriteSnapshot({ jobs: [{
    ...base,
    id: "kept",
    status: "completed",
    createdAt: 30,
    updatedAt: 31,
    hearted: true,
    loras: { pose: 0.8 },
    favoriteAssets: [{ id: "frame", name: "frame.png", type: "image/png", kind: "image", size: 5, createdAt: 10 }],
  }, {
    ...base,
    id: "remote-only",
    status: "completed",
    createdAt: 10,
    updatedAt: 10,
    hearted: true,
  }] });
  const merged = mergeFavoriteSnapshot(local, remote);
  assert.deepEqual(merged.map(({ id }) => id), ["kept", "stale", "remote-only"]);
  assert.equal(merged[0].hearted, true);
  assert.deepEqual(merged[0].loras, { pose: 0.8 });
  assert.equal(merged[0].favoriteAssets?.[0]?.id, "frame");
  assert.equal(merged[1].hearted, false);
});

test("Modal cloud sync names normalize consistently across devices", () => {
  assert.equal(normalizeCloudSyncUsername(" Tony.ZK "), "tony.zk");
  assert.equal(normalizeCloudSyncUsername("x"), null);
  assert.equal(normalizeCloudSyncUsername("not allowed"), null);
});

test("an empty cloud namespace clears local heart state", () => {
  const job = {
    id: "local", mode: "frames", prompt: "", duration: 5, aspect: "16:9",
    inputAssetIds: [], contentUrl: "", status: "completed", createdAt: 1,
    updatedAt: 1, hearted: true,
  } as Job;
  assert.equal(mergeFavoriteSnapshot([job], [])[0].hearted, false);
});

test("favorite source manifests retain remix roles", () => {
  const first = asset("first");
  const last = asset("last");
  const job = {
    id: "job", mode: "frames", prompt: "", duration: 5, aspect: "16:9",
    inputAssetIds: [first.id, last.id], firstFrameId: first.id, lastFrameId: last.id,
    contentUrl: "", status: "completed", createdAt: 1, updatedAt: 1,
  } as Job;
  assert.deepEqual(describeFavoriteAssets(job, [first, last]).map(({ role }) => role), ["firstFrame", "lastFrame"]);
});

test("GitHub star reminders appear at 2, 5, 10, and every ten completions", () => {
  const milestones = Array.from({ length: 42 }, (_, index) => index + 1).filter(isGithubStarReminderMilestone);
  assert.deepEqual(milestones, [2, 5, 10, 20, 30, 40]);
});

test("pending reference jobs retain remix asset IDs", () => {
  const references = [asset("new"), asset("old")];
  const job = pendingJob({ id: "job", status: "queued" }, { mode: "references", prompt: "scene", promptDocument: emptyPromptDocument(), duration: 10, aspect: "16:9", generationCount: 1, turbo: false, references });
  assert.deepEqual(job.referenceIds, ["new", "old"]);
  assert.equal(job.turbo, false);
});

test("new drafts default to two generations", () => {
  assert.equal(emptyFramesDraft().generationCount, 2);
  assert.equal(emptyReferencesDraft().generationCount, 2);
  assert.equal(emptyFramesDraft().turbo, true);
});

test("generation settings expose resolved metadata without the prompt", () => {
  const job = {
    id: "settings-job", mode: "frames", prompt: "private prompt text", duration: 5,
    aspect: "9:16", turbo: true, samplingProfile: "turbo_4", seed: "random",
    resolution: "768p", inputAssetIds: [], contentUrl: "", status: "completed",
    createdAt: 1_000, updatedAt: 93_000, samplingStartedAt: 31_000, finishedAt: 93_000,
    metadata: {
      model: "MiniMax-H3-FL2VA", checkpoint: "model.safetensors", width: 768,
      height: 1344, duration_seconds: 5.17, frames: 124, fps: 24, seed: 987654,
      steps: 4, sampler: "res_multistep", scheduler: "simple", turbo: true,
      sampling_profile: "turbo_4", resolution: "768p",
      lora: "turbo.safetensors", lora_strength: 1,
      audio: { native: true, sample_rate_hz: 32000, channels: 2 },
    },
  } as Job;
  const sections = generationSettingSections(job);
  const flat = sections.flatMap((section) => section.items);
  assert.equal(flat.find((entry) => entry.label === "Seed")?.value, "987654");
  assert.equal(flat.find((entry) => entry.label === "Output size")?.value, "768 × 1344");
  assert.equal(flat.find((entry) => entry.label === "Generation time")?.value, "1m 2s · sampling → video ready");
  assert.equal(flat.some((entry) => entry.label.toLowerCase().includes("prompt")), false);
  assert.equal(JSON.stringify(sections).includes(job.prompt), false);
  const withoutStart = generationSettingSections({ ...job, samplingStartedAt: undefined });
  assert.equal(withoutStart.flatMap((section) => section.items).some((entry) => entry.label === "Generation time"), false);
});

test("optimistic jobs start in the upload phase and retain batch position", () => {
  const draft = { ...emptyReferencesDraft(), prompt: "scene", references: [asset("hero")] };
  const job = uploadingJob("upload:batch:1", draft, { id: "batch", index: 1, size: 2, createdAt: 20 });
  assert.equal(job.status, "uploading");
  assert.equal(job.progress?.phase, "uploading");
  assert.equal(job.batchIndex, 1);
});

test("repeat generations stay together and retain their batch order", () => {
  const draft = { mode: "references", prompt: "scene", promptDocument: emptyPromptDocument(), duration: 5, aspect: "16:9", generationCount: 2, turbo: true, references: [asset("hero")] } as const;
  const first = { ...pendingJob({ id: "first", status: "queued" }, draft, { id: "batch", index: 0, size: 2, createdAt: 20 }), status: "completed" as const };
  const second = { ...pendingJob({ id: "second", status: "queued" }, draft, { id: "batch", index: 1, size: 2, createdAt: 20 }), status: "running" as const };
  const older = { ...first, id: "older", batchId: undefined, batchIndex: undefined, batchSize: undefined, createdAt: 10, status: "queued" as const };
  const batches = groupJobs([older, second, first]);
  assert.deepEqual(batches.map((batch) => batch.jobs.map(({ id }) => id)), [["first", "second"], ["older"]]);
  assert.deepEqual(sortJobs([older, second, first]).map(({ id }) => id), ["first", "second", "older"]);
});

test("reference mentions round-trip and disappear with their attachment", () => {
  const references = [asset("hero")];
  const document = promptTextToDocument("Follow <Picture 1>", references);
  assert.equal(promptDocumentToText(document, references), "Follow <Picture 1>");
  assert.equal(promptDocumentToText(prunePromptDocument(document, []), []), "Follow ");
});

test("replacing a reference retargets prompt mentions without mutating the original asset", () => {
  const original = asset("original");
  const document = promptTextToDocument("Follow <Picture 1> closely", [original]);
  const replacement = asset("replacement");
  const replacedDocument = replaceReferenceInPromptDocument(document, original.id, replacement);
  const hydrated = hydratePromptDocument(replacedDocument, [replacement]);
  const mention = hydrated.content?.[0]?.content?.find((node) => node.type === "referenceMention");
  assert.notEqual(replacement.id, original.id);
  assert.equal(mention?.attrs?.id, replacement.id);
  assert.equal(mention?.attrs?.label, replacement.name);
  assert.equal(promptDocumentToText(hydrated, [replacement]), "Follow <Picture 1> closely");
  assert.equal(promptDocumentToText(hydratePromptDocument(document, [original]), [original]), "Follow <Picture 1> closely");
});

test("stored reference tokens hydrate without case sensitivity", () => {
  const references = [asset("hero")];
  const document = promptTextToDocument("Follow <picture 1> then <PICTURE 1>", references);
  assert.equal(document.content?.[0]?.content?.filter((node) => node.type === "referenceMention").length, 2);
  assert.equal(promptDocumentToText(document, references), "Follow <Picture 1> then <Picture 1>");
});

test("reused prompts restore leaked attachment labels and IDs to reference tokens", () => {
  const references = [asset("reelo-91732892"), asset("voice", "audio")];
  assert.equal(
    restoreReferenceTokens("Use reelo-91732892.png, then voice, with voice.mp3.", references),
    "Use <Picture 1>, then <Audio 1>, with <Audio 1>.",
  );
});

test("reference recipes insert visible, editable H3 syntax", () => {
  const reference = asset("hall");
  const document = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: buildReferenceInsertion({
        asset: reference,
        token: "<Picture 1>",
        recipe: "storyboard",
        promptText: "<Subject 2> exists in [Shot 3].",
      }),
    }],
  };
  assert.equal(
    promptDocumentToText(document, [reference]),
    "<Picture 1> is a storyboard reference for [Shot 4], defining its viewpoint, subject placement, action, and shot order. ",
  );
});

test("subject and anchor recipes continue existing numbering", () => {
  const reference = asset("hero");
  const subject = buildReferenceInsertion({ asset: reference, token: "<Picture 1>", recipe: "subject", promptText: "<Subject 3>" });
  const anchor = buildReferenceInsertion({ asset: reference, token: "<Picture 1>", recipe: "anchor", anchor: "last frame", promptText: "[Shot 2]" });
  assert.equal(promptDocumentToText({ type: "doc", content: [{ type: "paragraph", content: subject }] }, [reference]), "<Subject 4> is the main visible subject shown in <Picture 1>. Preserve its defining identity and appearance. ");
  assert.equal(promptDocumentToText({ type: "doc", content: [{ type: "paragraph", content: anchor }] }, [reference]), "<Picture 1> is the last frame of [Shot 3], showing the composition in the reference image. ");
});

test("use-as-is picture recipes insert only the reference mention", () => {
  const reference = asset("hero");
  const content = buildReferenceInsertion({ asset: reference, token: "<Picture 1>", recipe: "as-is", promptText: "" });
  assert.deepEqual(content, [{
    type: "referenceMention",
    attrs: { id: reference.id, label: reference.name, kind: reference.kind, previewUrl: reference.previewUrl, token: "<Picture 1>" },
  }]);
  assert.equal(promptDocumentToText({ type: "doc", content: [{ type: "paragraph", content }] }, [reference]), "<Picture 1>");
});

test("the reference scaffold is visible but not generation-ready by itself", () => {
  assert.equal(hasReferencePromptContent(REFERENCE_PROMPT_STRUCTURE), false);
  assert.equal(hasReferencePromptContent(`${REFERENCE_PROMPT_STRUCTURE}\nA woman crosses the hallway.`), true);
});

test("reference scaffold sections become guidance tokens without changing submitted text", () => {
  const document = promptTextToDocument(REFERENCE_PROMPT_STRUCTURE);
  assert.equal(document.content?.filter((node) => node.content?.[0]?.type === PROMPT_SECTION_NODE).length, 6);
  assert.equal(promptDocumentToText(document), REFERENCE_PROMPT_STRUCTURE);
  assert.equal(document.content?.flatMap((node) => node.content ?? []).filter((node) => node.type === PROMPT_TASK_TYPE_NODE).length, 1);

  const legacy = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "summary:" }] }] };
  assert.equal(hydratePromptDocument(legacy, []).content?.[0]?.content?.[0]?.type, PROMPT_SECTION_NODE);
});

test("combined summary relationships round-trip as official H3 syntax", () => {
  const prompt = "summary: [reference generation + keyframe completion] A storyboard-guided opening shot.";
  const document = promptTextToDocument(prompt);
  assert.equal(promptDocumentToText(document), prompt);
  assert.equal(document.content?.[0]?.content?.some((node) => node.type === PROMPT_TASK_TYPE_NODE), true);
});

test("task relationships are removed from newest to oldest", () => {
  assert.deepEqual(removeLastPromptTaskType(["reference generation", "keyframe completion"]), ["reference generation"]);
  assert.deepEqual(removeLastPromptTaskType(["reference generation"]), []);
});

test("pasted summary text and an already-converted task token hydrate together", () => {
  const pasted = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "summary: " },
        { type: PROMPT_TASK_TYPE_NODE, attrs: { types: ["reference generation"] } },
      ],
    }],
  };
  const hydrated = hydratePromptDocument(pasted, []);
  assert.equal(hydrated.content?.[0]?.content?.[0]?.type, PROMPT_SECTION_NODE);
  assert.equal(promptDocumentToText(hydrated), "summary: [reference generation]");
});

test("video recipes insert explicit whole-video relationships", () => {
  const reference = asset("motion", "video");
  const render = (recipe: "video-source" | "video-continuation" | "video-structure") => promptDocumentToText({
    type: "doc",
    content: [{ type: "paragraph", content: buildReferenceInsertion({ asset: reference, token: "<Video 1>", recipe, promptText: "" }) }],
  }, [reference]);
  assert.equal(render("video-source"), "<Video 1> is the source video for the target video edit. ");
  assert.equal(render("video-continuation"), "The target video continues from the end of <Video 1>. ");
  assert.equal(render("video-structure"), "<Video 1> provides the camera movement, cuts, rhythm, and temporal structure for the target video. ");
});
