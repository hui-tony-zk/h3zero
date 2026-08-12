import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocalFirstVideoUrl } from "../src/lib/generatedVideos";

test("project videos prefer an existing IndexedDB object URL", async () => {
  let remoteDownloads = 0;
  const url = await resolveLocalFirstVideoUrl(
    async () => "blob:cached",
    async () => { remoteDownloads += 1; return "blob:downloaded"; },
  );

  assert.equal(url, "blob:cached");
  assert.equal(remoteDownloads, 0);
});

test("older project videos backfill IndexedDB after a local miss", async () => {
  let remoteDownloads = 0;
  const url = await resolveLocalFirstVideoUrl(
    async () => null,
    async () => { remoteDownloads += 1; return "blob:downloaded"; },
  );

  assert.equal(url, "blob:downloaded");
  assert.equal(remoteDownloads, 1);
});

test("missing project videos stay unavailable without a recovery URL", async () => {
  const url = await resolveLocalFirstVideoUrl(async () => null);
  assert.equal(url, null);
});
