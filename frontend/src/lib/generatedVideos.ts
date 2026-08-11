import { deleteGeneratedVideo, loadGeneratedVideo, saveGeneratedVideo } from "./assets";

const objectUrls = new Map<string, string>();
const pendingLoads = new Map<string, Promise<string | null>>();

function localUrl(id: string, blob: Blob) {
  const existing = objectUrls.get(id);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  objectUrls.set(id, url);
  return url;
}

export function loadGeneratedVideoUrl(id: string) {
  const existing = objectUrls.get(id);
  if (existing) return Promise.resolve(existing);

  const pending = pendingLoads.get(id);
  if (pending) return pending;

  const load = loadGeneratedVideo(id)
    .then((blob) => blob ? localUrl(id, blob) : null)
    .finally(() => pendingLoads.delete(id));
  pendingLoads.set(id, load);
  return load;
}

export function loadGeneratedVideoBlob(id: string) {
  return loadGeneratedVideo(id);
}

export async function cacheGeneratedVideo(id: string, sourceUrl: string) {
  const stored = await loadGeneratedVideoUrl(id);
  if (stored) return stored;

  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Could not download generated video (${response.status}).`);
  const blob = await response.blob();
  await saveGeneratedVideo(id, blob);
  return localUrl(id, blob);
}

export async function removeGeneratedVideo(id: string) {
  const url = objectUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(id);
  }
  await deleteGeneratedVideo(id);
}
