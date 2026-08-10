import type { ComposerDraft, FavoriteAsset, H3Specs, Job, MediaAsset } from "../../types";
import { parseFavoriteSnapshot } from "../favorites";
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
  const response = await fetch(`${API_BASE}/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (response.status === 404) return;
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
}

export async function getFavorites(username: string) {
  const response = await request(`/cloud-sync/${encodeURIComponent(username)}/favorites`, { headers: { Accept: "application/json" } });
  return parseFavoriteSnapshot(await response.json());
}

export async function putFavorite(username: string, job: Job, assets: MediaAsset[], manifest: FavoriteAsset[]) {
  const form = new FormData();
  form.set("job", JSON.stringify(job));
  form.set("assets", JSON.stringify(manifest));
  assets.forEach((asset, index) => form.set(`asset_${index}`, asset.file, asset.name));
  const response = await request(`/cloud-sync/${encodeURIComponent(username)}/favorites/${encodeURIComponent(job.id)}`, {
    method: "PUT",
    headers: { Accept: "application/json" },
    body: form,
  });
  const [saved] = parseFavoriteSnapshot({ jobs: [await response.json()] });
  if (!saved) throw new Error("The favorite response was invalid.");
  return saved;
}

export async function deleteFavorite(username: string, id: string) {
  await request(`/cloud-sync/${encodeURIComponent(username)}/favorites/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getFavoriteAsset(username: string, id: string) {
  return (await request(`/cloud-sync/${encodeURIComponent(username)}/assets/${encodeURIComponent(id)}`)).blob();
}

export function contentUrl(id: string) {
  return `${API_BASE}/jobs/${encodeURIComponent(id)}/video`;
}
