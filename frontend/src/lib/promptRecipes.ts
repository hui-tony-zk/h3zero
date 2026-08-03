import type { JSONContent } from "@tiptap/core";
import type { MediaAsset } from "../types";
import { REFERENCE_MENTION_NODE } from "./promptDocument";

export type ReferenceRecipe = "reference" | "subject" | "storyboard" | "anchor" | "video-source" | "video-continuation" | "video-structure";
export type AnchorKind = "first frame" | "keyframe" | "last frame" | "composition anchor";

type RecipeInput = {
  asset: MediaAsset;
  token: string;
  recipe: ReferenceRecipe;
  anchor?: AnchorKind;
  promptText: string;
};

function nextNumber(promptText: string, expression: RegExp) {
  let highest = 0;
  for (const match of promptText.matchAll(expression)) highest = Math.max(highest, Number(match[1]));
  return highest + 1;
}

function mention(asset: MediaAsset, token: string): JSONContent {
  return {
    type: REFERENCE_MENTION_NODE,
    attrs: { id: asset.id, label: asset.name, kind: asset.kind, previewUrl: asset.previewUrl, token },
  };
}

export function buildReferenceInsertion({ asset, token, recipe, anchor = "composition anchor", promptText }: RecipeInput): JSONContent[] {
  const reference = mention(asset, token);
  if (recipe === "reference") return [reference, { type: "text", text: " " }];

  if (recipe === "subject") {
    const subject = nextNumber(promptText, /<Subject (\d+)>/g);
    return [
      { type: "text", text: `<Subject ${subject}> is the main visible subject shown in ` },
      reference,
      { type: "text", text: ". Preserve its defining identity and appearance. " },
    ];
  }

  if (recipe === "video-source") {
    return [reference, { type: "text", text: " is the source video for the target video edit. " }];
  }

  if (recipe === "video-continuation") {
    return [
      { type: "text", text: "The target video continues from the end of " },
      reference,
      { type: "text", text: ". " },
    ];
  }

  if (recipe === "video-structure") {
    return [
      reference,
      { type: "text", text: " provides the camera movement, cuts, rhythm, and temporal structure for the target video. " },
    ];
  }

  const shot = nextNumber(promptText, /\[Shot (\d+)\]/g);
  if (recipe === "storyboard") {
    return [
      reference,
      { type: "text", text: ` is a storyboard reference for [Shot ${shot}], defining its viewpoint, subject placement, action, and shot order. ` },
    ];
  }

  return [
    reference,
    { type: "text", text: ` is the ${anchor} of [Shot ${shot}], showing the composition in the reference image. ` },
  ];
}
