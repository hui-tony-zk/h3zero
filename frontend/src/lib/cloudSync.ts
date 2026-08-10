const STORAGE_KEY = "h3-modal-cloud-sync-username-v1";
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;

export function normalizeCloudSyncUsername(value: string) {
  const normalized = value.trim().toLowerCase();
  return USERNAME.test(normalized) ? normalized : null;
}

export function readCloudSyncUsername() {
  try {
    return normalizeCloudSyncUsername(localStorage.getItem(STORAGE_KEY) ?? "");
  } catch {
    return null;
  }
}

export function writeCloudSyncUsername(username: string) {
  const normalized = normalizeCloudSyncUsername(username);
  if (!normalized) throw new Error("Use 2–32 letters, numbers, dots, hyphens, or underscores.");
  localStorage.setItem(STORAGE_KEY, normalized);
  return normalized;
}
