import type { MediaAsset, MediaKind } from "../types";

const DB_NAME = "h3-studio";
const STORE_NAME = "draft-assets";
const DB_VERSION = 1;
export const MAX_FRAME_BYTES = 20 * 1024 * 1024;

type StoredAsset = Omit<MediaAsset, "file" | "previewUrl"> & { blob: Blob };

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open draft storage."));
  });
}

function mediaKind(type: string): MediaKind {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "file";
}

function readImageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("This image could not be opened."));
    image.src = url;
  });
}

function readMediaDuration(url: string, kind: "video" | "audio") {
  return new Promise<number | undefined>((resolve) => {
    const media = document.createElement(kind);
    media.preload = "metadata";
    media.onloadedmetadata = () => resolve(Number.isFinite(media.duration) ? media.duration : undefined);
    media.onerror = () => resolve(undefined);
    media.src = url;
  });
}

export async function createMediaAsset(file: File, id = crypto.randomUUID()): Promise<MediaAsset> {
  const kind = mediaKind(file.type);
  const previewUrl = URL.createObjectURL(file);
  let width: number | undefined;
  let height: number | undefined;
  let duration: number | undefined;
  if (kind === "image") ({ width, height } = await readImageSize(previewUrl));
  if (kind === "video" || kind === "audio") duration = await readMediaDuration(previewUrl, kind);
  return { id, name: file.name, type: file.type, kind, size: file.size, file, previewUrl, width, height, duration, createdAt: Date.now() };
}

export async function saveAsset(asset: MediaAsset) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const { file, previewUrl: _previewUrl, ...metadata } = asset;
    transaction.objectStore(STORE_NAME).put({ ...metadata, blob: file } satisfies StoredAsset);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save attachment."));
  });
  database.close();
}

export async function loadAsset(id: string): Promise<MediaAsset | null> {
  const database = await openDatabase();
  const stored = await new Promise<StoredAsset | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result as StoredAsset | undefined);
    request.onerror = () => reject(request.error ?? new Error("Could not restore attachment."));
  });
  database.close();
  if (!stored) return null;
  const { blob, ...metadata } = stored;
  const file = new File([blob], metadata.name, { type: metadata.type });
  return { ...metadata, file, previewUrl: URL.createObjectURL(file) };
}

export function aspectRatio(asset: MediaAsset) {
  return asset.width && asset.height ? asset.width / asset.height : null;
}

export function ratiosMatch(left: MediaAsset, right: MediaAsset) {
  const a = aspectRatio(left);
  const b = aspectRatio(right);
  return a !== null && b !== null && Math.abs(a - b) < 0.01;
}

export async function cropImageAsset(asset: MediaAsset, targetRatio: number, focusX: number, focusY: number) {
  const bitmap = await createImageBitmap(asset.file);
  const sourceRatio = bitmap.width / bitmap.height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = bitmap.width;
  let sourceHeight = bitmap.height;
  if (sourceRatio > targetRatio) {
    sourceWidth = bitmap.height * targetRatio;
    sourceX = (bitmap.width - sourceWidth) * focusX;
  } else {
    sourceHeight = bitmap.width / targetRatio;
    sourceY = (bitmap.height - sourceHeight) * focusY;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth));
  canvas.height = Math.max(1, Math.round(sourceHeight));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Crop rendering is unavailable in this browser.");
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const outputType = asset.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not create the crop.")), outputType, 0.94));
  const stem = asset.name.replace(/\.[^.]+$/, "");
  const file = new File([blob], `${stem}-cropped.${outputType === "image/png" ? "png" : "jpg"}`, { type: outputType });
  return createMediaAsset(file);
}
