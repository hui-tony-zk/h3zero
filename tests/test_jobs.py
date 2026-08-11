import os
import tempfile
import time
import unittest
from pathlib import Path

from modal_services import jobs


class JobStorageTests(unittest.TestCase):
    def test_job_lifecycle_and_public_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            job_id = "a" * 32
            record = jobs.create_job(
                job_id,
                prompt="A fox in snow",
                config={"width": 864, "height": 480},
                has_first_frame=False,
                has_last_frame=True,
                root=root,
            )
            self.assertEqual(record["status"], "queued")

            jobs.write_call_id(job_id, "fc-test", root=root)
            jobs.update_job(
                job_id,
                root=root,
                status="running",
                call_id="fc-test",
                sampling_started_at="2026-08-11T16:01:00Z",
            )
            jobs.video_path(job_id, root).parent.mkdir(parents=True)
            jobs.video_path(job_id, root).write_bytes(b"video")
            completed = jobs.update_job(
                job_id,
                root=root,
                status="completed",
                result={"seed": 7, "bytes": 5},
            )
            public = jobs.public_job(completed)
            self.assertEqual(public["status"], "completed")
            self.assertEqual(public["mode"], "frames")
            self.assertEqual(public["result"]["video_url"], f"/api/jobs/{job_id}/video")
            self.assertEqual(public["progress"]["phase"], "queued")
            self.assertEqual(public["sampling_started_at"], "2026-08-11T16:01:00Z")
            self.assertNotIn("call_id", public)

            staged = jobs.input_path(job_id, "reference.png", root)
            staged.parent.mkdir(parents=True)
            staged.write_bytes(b"image")

            jobs.mark_deleted(job_id, root=root)
            jobs.delete_job_artifacts(job_id, root=root)
            self.assertTrue(jobs.is_deleted(job_id, root=root))
            self.assertIsNone(jobs.read_job(job_id, root=root))
            self.assertFalse(jobs.video_path(job_id, root).exists())
            self.assertFalse(jobs.input_dir(job_id, root).exists())

    def test_rejects_unsafe_ids(self):
        with self.assertRaisesRegex(ValueError, "invalid job id"):
            jobs.metadata_path("../../escape")

    def test_cleanup_prunes_stale_job_artifacts_and_old_tombstones(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            job_id = "b" * 32
            jobs.create_job(
                job_id,
                prompt="cleanup",
                config={},
                has_first_frame=False,
                has_last_frame=False,
                root=root,
            )
            jobs.update_job(job_id, root=root, status="completed", result={})
            jobs.write_call_id(job_id, "fc-cleanup", root=root)
            jobs.video_path(job_id, root).parent.mkdir(parents=True, exist_ok=True)
            jobs.video_path(job_id, root).write_bytes(b"video")
            staged = jobs.input_path(job_id, "source.png", root)
            staged.parent.mkdir(parents=True, exist_ok=True)
            staged.write_bytes(b"source")
            jobs.mark_deleted("c" * 32, root=root)

            old = time.time() - 1_000
            for path in (
                jobs.metadata_path(job_id, root),
                jobs.call_id_path(job_id, root),
                jobs.video_path(job_id, root),
                jobs.input_dir(job_id, root),
                jobs.tombstone_path("c" * 32, root),
            ):
                os.utime(path, (old, old))

            result = jobs.cleanup_stale_jobs(
                root,
                retention_seconds=100,
                tombstone_retention_seconds=100,
            )
            self.assertEqual(result["removed_job_ids"], [job_id])
            self.assertEqual(result["pruned_tombstones"], 1)
            self.assertIsNone(jobs.read_job(job_id, root))
            self.assertFalse(jobs.video_path(job_id, root).exists())
            self.assertFalse(jobs.input_dir(job_id, root).exists())


if __name__ == "__main__":
    unittest.main()
