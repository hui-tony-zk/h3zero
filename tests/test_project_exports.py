import tempfile
import unittest
from pathlib import Path

from modal_services import project_exports


class ProjectExportTests(unittest.TestCase):
    def project(self):
        return {
            "name": "Sequence / One",
            "aspect": "9:16",
            "clips": [
                {
                    "id": "clip-a",
                    "jobId": "a" * 32,
                    "inPoint": 1,
                    "outPoint": 5,
                    "sourceDuration": 8,
                    "playbackRate": 2,
                },
                {
                    "id": "clip-b",
                    "jobId": "b" * 32,
                    "inPoint": 0,
                    "outPoint": 3,
                    "sourceDuration": 3,
                    "playbackRate": 1,
                },
            ],
        }

    def test_normalizes_project_and_rejects_invalid_clip_bounds(self):
        normalized = project_exports.normalize_project(self.project())
        self.assertEqual(normalized["aspect"], "9:16")
        self.assertEqual([clip["order"] for clip in normalized["clips"]], [0, 1])
        self.assertEqual(
            [clip["transitionIn"] for clip in normalized["clips"]],
            ["fade-black", "fade-black"],
        )
        invalid = self.project()
        invalid["clips"][0]["outPoint"] = 9
        with self.assertRaisesRegex(ValueError, "exceeds its source duration"):
            project_exports.normalize_project(invalid)
        invalid_transition = self.project()
        invalid_transition["clips"][1]["transitionIn"] = "cross-dissolve"
        with self.assertRaisesRegex(ValueError, "unsupported transition"):
            project_exports.normalize_project(invalid_transition)

    def test_ffmpeg_command_preserves_order_trim_speed_aspect_and_audio(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            export_id = "c" * 32
            record = project_exports.create_export(export_id, self.project(), root=root)
            output = root / "render.mp4"
            command, duration = project_exports.build_ffmpeg_command(
                record,
                output,
                root=root,
                include_audio=True,
            )
            joined = " ".join(command)
            self.assertIn("scale=720:1280", joined)
            self.assertIn("setpts=(PTS-STARTPTS)/2.0", joined)
            self.assertIn("fade=t=out:st=1.7:d=0.3:color=black", joined)
            self.assertIn("fade=t=in:st=0:d=0.3:color=black", joined)
            self.assertIn("atempo=2.0", joined)
            self.assertIn("concat=n=2:v=1:a=1", joined)
            self.assertIn("-c:a aac", joined)
            self.assertAlmostEqual(duration, 5.0)

    def test_cleanup_removes_expired_export_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            export_id = "d" * 32
            project_exports.create_export(export_id, self.project(), root=root)
            removed = project_exports.cleanup_stale_exports(
                root,
                now=10_000_000_000,
                retention_seconds=0,
            )
            self.assertEqual(removed, [export_id])
            self.assertFalse(project_exports.export_dir(export_id, root).exists())

    def test_short_middle_clip_fades_are_shortened_without_overlapping(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = self.project()
            short = {
                "id": "clip-short",
                "jobId": "c" * 32,
                "inPoint": 0,
                "outPoint": 0.25,
                "sourceDuration": 0.25,
                "playbackRate": 2,
            }
            project["clips"].insert(1, short)
            record = project_exports.create_export(
                "e" * 32,
                project,
                root=temporary,
            )
            command, _ = project_exports.build_ffmpeg_command(
                record,
                Path(temporary) / "render.mp4",
                root=temporary,
                include_audio=False,
            )
            middle_filter = next(
                part for part in command if "[1:v]" in part
            )
            self.assertIn("fade=t=in:st=0:d=0.041666", middle_filter)
            self.assertIn("fade=t=out:st=0.083333", middle_filter)

    def test_individual_transition_can_use_a_hard_cut(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = self.project()
            project["clips"][1]["transitionIn"] = "cut"
            record = project_exports.create_export(
                "f" * 32,
                project,
                root=temporary,
            )
            command, _ = project_exports.build_ffmpeg_command(
                record,
                Path(temporary) / "render.mp4",
                root=temporary,
                include_audio=False,
            )
            joined = " ".join(command)
            self.assertNotIn("fade=t=", joined)


if __name__ == "__main__":
    unittest.main()
