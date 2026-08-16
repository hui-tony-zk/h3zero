import json
import shutil
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from modal_services import favorites, jobs, project_exports
from modal_services.gateway import create_gateway, parse_config


class FakeModalMethod:
    def __init__(self, implementation):
        self.implementation = implementation
        self.sync_calls = 0
        self.aio_calls = 0

    def __call__(self, *args, **kwargs):
        self.sync_calls += 1
        return self.implementation(*args, **kwargs)

    async def aio(self, *args, **kwargs):
        self.aio_calls += 1
        return self.implementation(*args, **kwargs)


class FakeVolume:
    def __init__(self):
        self.commits = 0
        self.reloads = 0
        self.commit = FakeModalMethod(self._commit)
        self.reload = FakeModalMethod(self._reload)

    def _commit(self):
        self.commits += 1

    def _reload(self):
        self.reloads += 1


class FakeProgressStore:
    def __init__(self):
        self.values = {}
        self.get = FakeModalMethod(self._get)
        self.put = FakeModalMethod(self._put)
        self.pop = FakeModalMethod(self._pop)

    def _get(self, key, default=None):
        return self.values.get(key, default)

    def _put(self, key, value):
        self.values[key] = value

    def _pop(self, key):
        return self.values.pop(key)


class FakeCall:
    def __init__(self, object_id="fc-test"):
        self.object_id = object_id
        self.result = None
        self.error = TimeoutError()
        self.cancelled = False

    def get(self, timeout=0):
        if self.error is not None:
            raise self.error
        return self.result

    def cancel(self):
        self.cancelled = True


class FakeGenerate:
    def __init__(self, call):
        self.call = call
        self.submissions = []
        self.spawn = FakeModalMethod(self._spawn)

    def _spawn(self, **kwargs):
        self.submissions.append(kwargs)
        return self.call


class FakeService:
    def __init__(self, call):
        self.generate = FakeGenerate(call)


class FakeProjectExportFunction:
    def __init__(self, call):
        self.call = call
        self.submissions = []
        self.spawn = FakeModalMethod(self._spawn)

    def _spawn(self, export_id):
        self.submissions.append(export_id)
        return self.call


class GatewayTests(unittest.TestCase):
    @staticmethod
    def png(width=512, height=512):
        return (
            b"\x89PNG\r\n\x1a\n"
            + b"\x00\x00\x00\rIHDR"
            + width.to_bytes(4, "big")
            + height.to_bytes(4, "big")
        )

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        base = Path(self.temporary.name)
        self.output_root = base / "outputs"
        self.dist = base / "dist"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "index.html").write_text("<h1>H3</h1>", encoding="utf-8")
        (self.dist / "assets" / "app.js").write_text("console.log('h3')", encoding="utf-8")
        self.volume = FakeVolume()
        self.progress = FakeProgressStore()
        self.call = FakeCall()
        self.export_call = FakeCall("fc-export")
        self.service = FakeService(self.call)
        self.export_function = FakeProjectExportFunction(self.export_call)
        self.calls = {
            self.call.object_id: self.call,
            self.export_call.object_id: self.export_call,
        }

        def fake_probe(path):
            path = Path(path)
            duration = 8.0 if "eight" in path.name else 4.0
            if path.suffix in {".mp3", ".wav", ".m4a"}:
                return {
                    "duration_seconds": 3.0,
                    "has_video": False,
                    "has_audio": True,
                }
            return {
                "duration_seconds": duration,
                "has_video": True,
                "has_audio": "silent" not in path.name,
                "width": 640,
                "height": 360,
                "fps": 30.0,
            }

        def fake_normalize(source, destination, *, include_audio):
            shutil.copyfile(source, destination)
            return {
                "duration_seconds": 4.0,
                "has_video": True,
                "has_audio": include_audio,
                "width": 640,
                "height": 360,
                "fps": 24.0,
            }

        app = create_gateway(
            output_volume=self.volume,
            service_factory=lambda: self.service,
            function_call_from_id=lambda call_id: self.calls[call_id],
            output_root=self.output_root,
            frontend_dist=self.dist,
            progress_store=self.progress,
            project_export_function=self.export_function,
            probe_media=fake_probe,
            normalize_video=fake_normalize,
        )
        self.client = TestClient(app)

    def test_local_project_export_uploads_polls_and_downloads(self):
        job_id = "e" * 32
        project = {
            "name": "Opening cut",
            "aspect": "16:9",
            "clips": [{
                "id": "clip-one",
                "jobId": job_id,
                "inPoint": 1,
                "outPoint": 4,
                "sourceDuration": 5,
                "playbackRate": 1.25,
            }],
        }
        created = self.client.post(
            "/api/project-exports",
            data={"project": json.dumps(project)},
            files={f"video_{job_id}": (f"{job_id}.mp4", b"project-video", "video/mp4")},
        )
        self.assertEqual(created.status_code, 202, created.text)
        export_id = created.json()["id"]
        self.assertEqual(self.export_function.submissions, [export_id])
        self.assertEqual(
            project_exports.input_path(export_id, job_id, self.output_root).read_bytes(),
            b"project-video",
        )

        pending = self.client.get(f"/api/project-exports/{export_id}")
        self.assertEqual(pending.status_code, 200)
        self.assertEqual(pending.json()["status"], "queued")

        project_exports.video_path(export_id, self.output_root).write_bytes(b"exported-mp4")
        project_exports.update_export(export_id, root=self.output_root, status="completed")
        completed = self.client.get(f"/api/project-exports/{export_id}")
        self.assertEqual(completed.json()["download_url"], f"/api/project-exports/{export_id}/video")
        video = self.client.get(f"/api/project-exports/{export_id}/video")
        self.assertEqual(video.status_code, 200)
        self.assertEqual(video.content, b"exported-mp4")

    def tearDown(self):
        self.temporary.cleanup()

    def submit(self):
        response = self.client.post(
            "/api/jobs",
            data={
                "prompt": "A fox crossing fresh snow. Audio: soft wind.",
                "config": json.dumps({"width": 512, "height": 512, "seed": 9}),
            },
            files={
                "first_frame": (
                    "first.png",
                    self.png(),
                    "image/png",
                )
            },
        )
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()

    def test_health_and_spa_do_not_submit_gpu_work(self):
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertFalse(health.json()["gpu_invoked"])
        self.assertEqual(self.client.get("/projects/demo").text, "<h1>H3</h1>")
        self.assertIn("console.log", self.client.get("/assets/app.js").text)
        specs = self.client.get("/api/specs")
        self.assertEqual(specs.status_code, 200)
        self.assertTrue(specs.json()["modes"]["references"]["available"])
        self.assertEqual(self.service.generate.submissions, [])

    def test_submit_poll_complete_and_stream(self):
        submitted = self.submit()
        job_id = submitted["id"]
        self.assertEqual(self.volume.commit.sync_calls, 0)
        self.assertEqual(self.volume.commit.aio_calls, 2)
        self.assertEqual(self.progress.put.sync_calls, 0)
        self.assertEqual(self.progress.put.aio_calls, 1)
        self.assertEqual(self.progress.get.sync_calls, 0)
        self.assertEqual(self.progress.get.aio_calls, 1)
        self.assertEqual(self.service.generate.spawn.sync_calls, 0)
        self.assertEqual(self.service.generate.spawn.aio_calls, 1)
        self.assertEqual(submitted["status"], "queued")
        payload = self.service.generate.submissions[0]
        self.assertTrue(payload["persist_output"])
        self.assertEqual(payload["job_id"], job_id)
        self.assertEqual(payload["first_frame"][:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual((payload["width"], payload["height"]), (480, 480))
        self.assertEqual(payload["geometry_source"], "first_frame")
        self.assertTrue(payload["turbo"])
        self.assertEqual(payload["sampling_profile"], "turbo_4")
        self.assertEqual(payload["resolution"], "480p")
        self.assertEqual(payload["steps"], 4)
        self.assertEqual(payload["sampler"], "res_multistep")
        self.assertEqual(payload["scheduler"], "simple")

        pending = self.client.get(f"/api/jobs/{job_id}")
        self.assertEqual(pending.json()["status"], "queued")
        self.assertEqual(pending.json()["progress"]["phase"], "queued")

        self.progress.put(
            job_id,
            {
                "phase": "sampling",
                "message": "Generating video and audio",
                "updated_at": "2026-08-03T00:00:00Z",
                "percent": 0.4,
            },
        )
        progress = self.client.get(f"/api/jobs/{job_id}").json()["progress"]
        self.assertEqual(progress["phase"], "sampling")
        self.assertEqual(progress["percent"], 0.4)

        path = jobs.video_path(job_id, self.output_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fake-mp4")
        jobs.update_job(
            job_id,
            root=self.output_root,
            status="completed",
            result={"seed": 9, "bytes": 8, "model": "MiniMax-H3-FL2VA"},
        )
        completed = self.client.get(f"/api/jobs/{job_id}")
        self.assertEqual(completed.json()["status"], "completed")
        video = self.client.get(f"/api/jobs/{job_id}/video")
        self.assertEqual(video.status_code, 200)
        self.assertEqual(video.headers["content-type"], "video/mp4")
        self.assertEqual(video.content, b"fake-mp4")

    def test_delete_cancels_pending_call_and_removes_job(self):
        job_id = self.submit()["id"]
        events = []
        original_cancel = self.call.cancel
        original_commit = self.volume.commit.implementation

        def tracked_cancel():
            events.append("cancel")
            original_cancel()

        def tracked_commit():
            events.append("commit")
            original_commit()

        self.call.cancel = tracked_cancel
        self.volume.commit.implementation = tracked_commit
        response = self.client.delete(f"/api/jobs/{job_id}")
        self.assertEqual(response.status_code, 204)
        self.assertTrue(self.call.cancelled)
        self.assertEqual(events[0], "cancel")
        self.assertEqual(self.client.get(f"/api/jobs/{job_id}").status_code, 404)
        self.assertTrue(jobs.is_deleted(job_id, self.output_root))

    def test_favorites_sync_output_metadata_and_remix_sources(self):
        job_id = self.submit()["id"]
        path = jobs.video_path(job_id, self.output_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"favorite-mp4")
        jobs.update_job(
            job_id,
            root=self.output_root,
            status="completed",
            result={
                "seed": 9,
                "width": 480,
                "height": 480,
                "loras": [{
                    "id": "pose",
                    "name": "Pose",
                    "filename": "pose.safetensors",
                    "strength": 0.8,
                }],
            },
        )
        favorite_job = {
            "id": job_id,
            "mode": "frames",
            "prompt": "client prompt is not authoritative",
            "createdAt": 1234,
            "updatedAt": 1234,
            "status": "completed",
            "duration": 5,
            "aspect": "16:9",
            "loras": {"client-value-is-not-authoritative": 1.0},
            "inputAssetIds": ["source-frame"],
            "firstFrameId": "source-frame",
            "contentUrl": "wrong",
        }
        asset_manifest = [{
            "id": "source-frame",
            "name": "first.png",
            "type": "image/png",
            "kind": "image",
            "size": len(self.png()),
            "width": 512,
            "height": 512,
            "createdAt": 1000,
            "role": "firstFrame",
        }]
        saved = self.client.put(
            f"/api/cloud-sync/tony/favorites/{job_id}",
            data={"job": json.dumps(favorite_job), "assets": json.dumps(asset_manifest)},
            files={"asset_0": ("first.png", self.png(), "image/png")},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertTrue(saved.json()["hearted"])
        self.assertEqual(saved.json()["prompt"], "A fox crossing fresh snow. Audio: soft wind.")
        self.assertEqual(saved.json()["loras"], {"pose": 0.8})
        self.assertEqual(
            saved.json()["contentUrl"],
            f"/api/cloud-sync/tony/favorites/{job_id}/video",
        )

        snapshot = self.client.get("/api/cloud-sync/tony/favorites")
        self.assertEqual(snapshot.status_code, 200)
        self.assertEqual([item["id"] for item in snapshot.json()["jobs"]], [job_id])
        self.assertEqual(snapshot.json()["jobs"][0]["loras"], {"pose": 0.8})
        self.assertEqual(snapshot.json()["username"], "tony")
        self.assertEqual(self.client.get("/api/cloud-sync/other/favorites").json()["jobs"], [])
        asset = self.client.get("/api/cloud-sync/tony/assets/source-frame")
        self.assertEqual(asset.status_code, 200)
        self.assertEqual(asset.content, self.png())
        favorite_video = self.client.get(
            f"/api/cloud-sync/tony/favorites/{job_id}/video"
        )
        self.assertEqual(favorite_video.status_code, 200)
        self.assertEqual(favorite_video.content, b"favorite-mp4")

        removed = self.client.delete(f"/api/cloud-sync/tony/favorites/{job_id}")
        self.assertEqual(removed.status_code, 204)
        self.assertEqual(self.client.get("/api/cloud-sync/tony/favorites").json()["jobs"], [])
        self.assertEqual(self.client.get("/api/cloud-sync/tony/assets/source-frame").status_code, 404)
        self.assertEqual(
            self.client.get(f"/api/cloud-sync/tony/favorites/{job_id}/video").status_code,
            404,
        )
        self.assertEqual(self.client.get(f"/api/jobs/{job_id}/video").content, b"favorite-mp4")

    def test_acknowledgement_releases_a_browser_cached_result(self):
        job_id = self.submit()["id"]
        path = jobs.video_path(job_id, self.output_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"temporary-mp4")
        jobs.update_job(job_id, root=self.output_root, status="completed", result={})

        acknowledged = self.client.post(f"/api/jobs/{job_id}/acknowledge")
        self.assertEqual(acknowledged.status_code, 204)
        self.assertFalse(path.exists())
        self.assertIsNone(jobs.read_job(job_id, self.output_root))
        self.assertNotIn(job_id, self.progress.values)
        self.assertEqual(self.client.post(f"/api/jobs/{job_id}/acknowledge").status_code, 204)

    def test_cached_video_can_be_favorited_after_job_acknowledgement(self):
        job_id = self.submit()["id"]
        path = jobs.video_path(job_id, self.output_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"temporary-mp4")
        jobs.update_job(job_id, root=self.output_root, status="completed", result={})
        self.assertEqual(self.client.post(f"/api/jobs/{job_id}/acknowledge").status_code, 204)

        saved = self.client.put(
            f"/api/cloud-sync/tony/favorites/{job_id}",
            data={
                "job": json.dumps({
                    "id": job_id,
                    "mode": "frames",
                    "prompt": "locally retained prompt",
                    "duration": 5,
                    "inputAssetIds": [],
                    "metadata": {"seed": 9},
                }),
                "assets": "[]",
            },
            files={"video": (f"{job_id}.mp4", b"browser-cached-mp4", "video/mp4")},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["prompt"], "locally retained prompt")
        favorite_video = self.client.get(
            f"/api/cloud-sync/tony/favorites/{job_id}/video"
        )
        self.assertEqual(favorite_video.content, b"browser-cached-mp4")

        # Deleting a locally acknowledged job remains idempotent and removes
        # its cloud favorite, preserving the existing UI delete behavior.
        self.assertEqual(self.client.delete(f"/api/jobs/{job_id}").status_code, 204)
        self.assertIsNone(favorites.read_favorite("tony", job_id, self.output_root))

    def test_legacy_favorite_is_migrated_before_its_job_video_is_removed(self):
        job_id = self.submit()["id"]
        source = jobs.video_path(job_id, self.output_root)
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b"legacy-favorite-mp4")
        jobs.update_job(job_id, root=self.output_root, status="completed", result={})
        favorites.write_favorite("tony", {
            "id": job_id,
            "createdAt": 1,
            "contentUrl": f"/api/jobs/{job_id}/video",
        }, self.output_root)

        snapshot = self.client.get("/api/cloud-sync/tony/favorites")
        self.assertEqual(snapshot.status_code, 200)
        self.assertEqual(
            snapshot.json()["jobs"][0]["contentUrl"],
            f"/api/cloud-sync/tony/favorites/{job_id}/video",
        )
        self.assertEqual(
            favorites.video_path("tony", job_id, self.output_root).read_bytes(),
            b"legacy-favorite-mp4",
        )

    def test_deleting_a_job_also_removes_its_favorite(self):
        job_id = self.submit()["id"]
        path = jobs.video_path(job_id, self.output_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"favorite-mp4")
        jobs.update_job(job_id, root=self.output_root, status="completed", result={"seed": 9})
        favorite_job = {
            "id": job_id,
            "createdAt": 1234,
            "aspect": "16:9",
            "inputAssetIds": ["source-frame"],
            "firstFrameId": "source-frame",
        }
        assets = [{
            "id": "source-frame", "name": "first.png", "type": "image/png",
            "kind": "image", "role": "firstFrame",
        }]
        response = self.client.put(
            f"/api/cloud-sync/tony/favorites/{job_id}",
            data={"job": json.dumps(favorite_job), "assets": json.dumps(assets)},
            files={"asset_0": ("first.png", self.png(), "image/png")},
        )
        self.assertEqual(response.status_code, 200, response.text)

        self.assertEqual(self.client.delete(f"/api/jobs/{job_id}").status_code, 204)
        self.assertEqual(self.client.get("/api/cloud-sync/tony/favorites").json()["jobs"], [])
        self.assertEqual(self.client.get("/api/cloud-sync/tony/assets/source-frame").status_code, 404)

    def test_favorite_rejects_unsafe_or_unrelated_assets(self):
        job_id = self.submit()["id"]
        path = jobs.video_path(job_id, self.output_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"favorite-mp4")
        jobs.update_job(job_id, root=self.output_root, status="completed", result={})
        response = self.client.put(
            f"/api/cloud-sync/tony/favorites/{job_id}",
            data={
                "job": json.dumps({"id": job_id, "inputAssetIds": ["safe-id"]}),
                "assets": json.dumps([{
                    "id": "../escape", "name": "bad.png", "type": "image/png", "kind": "image",
                }]),
            },
            files={"asset_0": ("bad.png", self.png(), "image/png")},
        )
        self.assertEqual(response.status_code, 422)

        invalid_username = self.client.get("/api/cloud-sync/x/favorites")
        self.assertEqual(invalid_username.status_code, 422)

    def test_failed_and_expired_states_are_explicit(self):
        failed_id = self.submit()["id"]
        self.call.error = RuntimeError("boom")
        failed = self.client.get(f"/api/jobs/{failed_id}").json()
        self.assertEqual(failed["status"], "failed")
        self.assertIn("boom", failed["error"])

        self.call = FakeCall("fc-expired")
        self.service = FakeService(self.call)
        self.calls[self.call.object_id] = self.call
        expired_id = self.submit()["id"]
        class OutputExpiredError(Exception):
            pass
        self.call.error = OutputExpiredError()
        jobs.update_job(expired_id, root=self.output_root, created_at_unix=0)
        expired = self.client.get(f"/api/jobs/{expired_id}").json()
        self.assertEqual(expired["status"], "expired")

    def test_validation_rejects_bad_config_and_images(self):
        response = self.client.post(
            "/api/jobs",
            data={"prompt": "test", "config": '{"unknown": true}'},
        )
        self.assertEqual(response.status_code, 422)
        response = self.client.post(
            "/api/jobs",
            data={"prompt": "test"},
            files={"last_frame": ("bad.txt", b"bad", "text/plain")},
        )
        self.assertEqual(response.status_code, 422)
        with self.assertRaisesRegex(ValueError, "width must be an integer"):
            parse_config("test", '{"width": true}')
        base = parse_config("test", '{"turbo": false}')
        self.assertEqual(
            (base["sampling_profile"], base["steps"], base["sampler"], base["scheduler"]),
            ("spectrum", 20, "res_multistep", "simple"),
        )
        turbo_8 = parse_config("test", '{"sampling_profile":"turbo_8","seed":42}')
        self.assertEqual(
            (turbo_8["turbo"], turbo_8["steps"], turbo_8["seed"]),
            (True, 8, 42),
        )
        spectrum = parse_config("test", '{"sampling_profile":"spectrum","seed":106}')
        self.assertEqual(
            (spectrum["turbo"], spectrum["steps"], spectrum["seed"]),
            (False, 20, 106),
        )
        high_resolution = parse_config(
            "test",
            '{"resolution":"768p","width":1344,"height":768}',
        )
        self.assertEqual(
            (high_resolution["resolution"], high_resolution["width"], high_resolution["height"]),
            ("768p", 1344, 768),
        )
        with self.assertRaisesRegex(ValueError, "turbo conflicts"):
            parse_config("test", '{"sampling_profile":"spectrum","turbo":true}')
        with self.assertRaisesRegex(ValueError, "sampling_profile must be one of"):
            parse_config("test", '{"sampling_profile":"unknown"}')
        with self.assertRaisesRegex(ValueError, "turbo must be a boolean"):
            parse_config("test", '{"turbo": "no"}')
        with self.assertRaisesRegex(ValueError, "resolution must be one of"):
            parse_config("test", '{"resolution":"1080p"}')
        with self.assertRaisesRegex(ValueError, "unknown or unavailable LoRAs"):
            parse_config("test", '{"loras": {"not-configured": 1.0}}')
        response = self.client.post(
            "/api/jobs",
            data={"prompt": "test", "width": "512"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("unknown multipart fields", response.text)
        response = self.client.post(
            "/api/jobs",
            data={"prompt": "test", "config": '{"width": 640, "height": 480}'},
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("480p native presets", response.text)

    def test_rejects_uncropped_mismatched_frames(self):
        response = self.client.post(
            "/api/jobs",
            data={
                "prompt": "Bridge the two frames",
                "config": json.dumps({"geometry_source": "last_frame"}),
            },
            files={
                "first_frame": ("first.png", self.png(1600, 900), "image/png"),
                "last_frame": ("last.png", self.png(1024, 1024), "image/png"),
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("crop it before submission", response.text)

    def test_reference_submission_preserves_global_order_and_tags(self):
        declarations = [
            {"id": "new-audio", "kind": "audio", "field": "reference_0"},
            {"id": "middle-image", "kind": "image", "field": "reference_1"},
            {
                "id": "old-video",
                "kind": "video",
                "field": "reference_2",
                "use_audio": True,
            },
        ]
        response = self.client.post(
            "/api/jobs",
            data={
                "prompt": "Use all references in their supplied order.",
                "config": json.dumps({
                    "mode": "references",
                    "width": 864,
                    "height": 480,
                    "references": declarations,
                }),
            },
            files=[
                ("reference_0", ("voice.mp3", b"audio", "audio/mpeg")),
                ("reference_1", ("look.png", self.png(640, 480), "image/png")),
                ("reference_2", ("motion.mov", b"video", "video/quicktime")),
            ],
        )
        self.assertEqual(response.status_code, 202, response.text)
        submitted = response.json()
        public_refs = submitted["request"]["references"]
        self.assertEqual(
            [item["id"] for item in public_refs],
            ["new-audio", "middle-image", "old-video"],
        )
        self.assertEqual(public_refs[0]["tags"], ["<Audio 1>"])
        self.assertEqual(public_refs[1]["tags"], ["<Picture 1>"])
        self.assertEqual(public_refs[2]["tags"], ["<Audio 2>", "<Video 1>"])
        self.assertNotIn("staged_filename", public_refs[2])

        payload = self.service.generate.submissions[0]
        self.assertEqual(payload["mode"], "references")
        self.assertEqual(payload["ref_image_size"], "match")
        self.assertIsNone(payload["first_frame"])
        self.assertEqual(
            [item["id"] for item in payload["references"]],
            ["new-audio", "middle-image", "old-video"],
        )
        self.assertTrue(payload["references"][2]["staged_filename"].endswith("-24fps.mp4"))
        self.assertTrue(jobs.input_dir(submitted["id"], self.output_root).is_dir())

    def test_reference_preflight_rejects_audio_only(self):
        response = self.client.post(
            "/api/jobs",
            data={
                "prompt": "Audio only",
                "config": json.dumps({
                    "mode": "references",
                    "references": [
                        {"id": "voice", "kind": "audio", "field": "reference_0"}
                    ],
                }),
            },
            files={"reference_0": ("voice.mp3", b"audio", "audio/mpeg")},
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("sole reference modality", response.text)

    def test_reference_preflight_enforces_counts_durations_and_video_audio(self):
        too_many_images = [
            {
                "id": f"image-{index}",
                "kind": "image",
                "field": f"reference_{index}",
            }
            for index in range(10)
        ]
        response = self.client.post(
            "/api/jobs",
            data={
                "prompt": "Too many images",
                "config": json.dumps({
                    "mode": "references",
                    "references": too_many_images,
                }),
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("at most 9 images", response.text)

        declarations = [
            {"id": "look", "kind": "image", "field": "reference_0"},
            {
                "id": "silent-video",
                "kind": "video",
                "field": "reference_1",
                "use_audio": True,
            },
        ]
        response = self.client.post(
            "/api/jobs",
            data={
                "prompt": "Silent soundtrack request",
                "config": json.dumps({
                    "mode": "references",
                    "references": declarations,
                }),
            },
            files=[
                ("reference_0", ("look.png", self.png(), "image/png")),
                ("reference_1", ("silent.mp4", b"video", "video/mp4")),
            ],
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("requested use_audio", response.text)

        declarations = [
            {"id": "look", "kind": "image", "field": "reference_0"},
            {"id": "eight-one", "kind": "video", "field": "reference_1"},
            {"id": "eight-two", "kind": "video", "field": "reference_2"},
        ]
        response = self.client.post(
            "/api/jobs",
            data={
                "prompt": "Too much reference video",
                "config": json.dumps({
                    "mode": "references",
                    "references": declarations,
                }),
            },
            files=[
                ("reference_0", ("look.png", self.png(), "image/png")),
                ("reference_1", ("one.mp4", b"video-one", "video/mp4")),
                ("reference_2", ("two.mp4", b"video-two", "video/mp4")),
            ],
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("total reference video duration", response.text)


if __name__ == "__main__":
    unittest.main()
