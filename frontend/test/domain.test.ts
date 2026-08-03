import assert from "node:assert/strict";
import test from "node:test";
import { isGithubStarReminderMilestone } from "../src/lib/githubStarReminder";
import { pendingJob, sortJobs } from "../src/lib/jobs";
import { emptyPromptDocument, hydratePromptDocument, promptDocumentToText, promptTextToDocument, prunePromptDocument } from "../src/lib/promptDocument";
import { PROMPT_SECTION_NODE } from "../src/lib/promptSections";
import { PROMPT_TASK_TYPE_NODE, removeLastPromptTaskType } from "../src/lib/promptTaskTypes";
import { hasReferencePromptContent, REFERENCE_PROMPT_STRUCTURE } from "../src/lib/promptDefaults";
import { buildReferenceInsertion } from "../src/lib/promptRecipes";
import type { Job } from "../src/types";
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

test("GitHub star reminders appear at 2, 5, 10, and every ten completions", () => {
  const milestones = Array.from({ length: 42 }, (_, index) => index + 1).filter(isGithubStarReminderMilestone);
  assert.deepEqual(milestones, [2, 5, 10, 20, 30, 40]);
});

test("pending reference jobs retain remix asset IDs", () => {
  const references = [asset("new"), asset("old")];
  const job = pendingJob({ id: "job", status: "queued" }, { mode: "references", prompt: "scene", promptDocument: emptyPromptDocument(), duration: 10, aspect: "16:9", references });
  assert.deepEqual(job.referenceIds, ["new", "old"]);
});

test("reference mentions round-trip and disappear with their attachment", () => {
  const references = [asset("hero")];
  const document = promptTextToDocument("Follow <Picture 1>", references);
  assert.equal(promptDocumentToText(document, references), "Follow <Picture 1>");
  assert.equal(promptDocumentToText(prunePromptDocument(document, []), []), "Follow ");
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
