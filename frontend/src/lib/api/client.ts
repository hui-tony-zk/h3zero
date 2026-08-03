import type { ComposerDraft, H3Specs } from "../../types";
import { parseJobCreate, parseJobStatus, parseSpecs } from "./contracts";
import { buildCreateJobRequest } from "./createJobRequest";

const API_BASE = "/api";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseError(response: Response) {
  try {
    const data = await response.json() as Record<string, unknown>;
    const detail = data.detail ?? data.error ?? data.message;
    return typeof detail === "string" ? detail : JSON.stringify(detail ?? data);
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response;
}

export async function getSpecs() {
  return parseSpecs(await (await request("/specs", { headers: { Accept: "application/json" } })).json());
}

export async function createJob(draft: ComposerDraft, specs: H3Specs) {
  const response = await request("/jobs", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: buildCreateJobRequest(draft, specs),
  });
  return parseJobCreate(await response.json());
}

export async function getJobStatus(id: string) {
  const response = await request(`/jobs/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } });
  return parseJobStatus(await response.json(), id);
}

export async function deleteJob(id: string) {
  await request(`/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function contentUrl(id: string) {
  return `${API_BASE}/jobs/${encodeURIComponent(id)}/video`;
}
