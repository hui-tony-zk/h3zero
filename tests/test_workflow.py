import unittest
import json

from minimax_h3.workflow import (
    MAX_PIXELS,
    aligned_frame_count,
    build_frames_workflow,
    build_reference_workflow,
    validate_image_bytes,
)


class WorkflowTests(unittest.TestCase):
    @staticmethod
    def png(width=32, height=32):
        return (
            b"\x89PNG\r\n\x1a\n"
            + b"\x00\x00\x00\rIHDR"
            + width.to_bytes(4, "big")
            + height.to_bytes(4, "big")
        )

    def test_duration_snaps_to_h3_grid(self):
        self.assertEqual(aligned_frame_count(5), 124)
        self.assertEqual(aligned_frame_count(15), 362)
        self.assertEqual(aligned_frame_count(5) % 17, 5)

    def test_builds_turbo_t2v_graph(self):
        workflow = build_frames_workflow(
            prompt="A lighthouse in a storm. Audio: waves and distant thunder.",
            width=864,
            height=480,
            duration_seconds=5,
            seed=42,
        )
        classes = {node["class_type"] for node in workflow.values()}
        self.assertIn("MiniMaxH3ImageToVideo", classes)
        self.assertIn("VAEDecodeAudio", classes)
        self.assertIn("SaveVideo", classes)
        self.assertEqual(workflow["conditioning"]["inputs"]["length"], 124)
        self.assertEqual(workflow["noise"]["inputs"]["noise_seed"], 42)
        self.assertEqual(
            workflow["model"]["inputs"]["unet_name"],
            "minimax_h3_fl2va_int8_convrot.safetensors",
        )
        self.assertEqual(
            workflow["clip"]["inputs"]["clip_name"],
            "qwen3vl_32b_minimax_h3_int8_convrot.safetensors",
        )
        self.assertEqual(workflow["turbo_lora"]["class_type"], "MiniMaxH3TurboLoRA")
        self.assertEqual(workflow["turbo_lora"]["inputs"], {
            "model": ["model", 0],
            "lora_name": "minimax_h3_turbo_v4_step600_ema.safetensors",
            "strength": 1.0,
            "low_vram": False,
        })
        self.assertEqual(workflow["sampler"]["class_type"], "MiniMaxH3TurboSampler")
        self.assertEqual(workflow["scheduler"]["inputs"]["steps"], 8)
        self.assertEqual(workflow["scheduler"]["inputs"]["scheduler"], "simple")
        self.assertEqual(workflow["scheduler"]["inputs"]["model"], ["turbo_lora", 0])
        self.assertEqual(workflow["guider"]["inputs"]["model"], ["turbo_lora", 0])

    def test_optional_keyframes_add_load_nodes(self):
        workflow = build_frames_workflow(
            prompt="Move between the keyframes.",
            width=512,
            height=512,
            duration_seconds=5,
            seed=7,
            first_frame_filename="first.png",
            last_frame_filename="last.jpg",
        )
        self.assertEqual(workflow["load_first_frame"]["class_type"], "LoadImage")
        self.assertEqual(
            workflow["conditioning"]["inputs"]["last_frame"],
            ["load_last_frame", 0],
        )

    def test_rejects_oversized_canvas(self):
        with self.assertRaisesRegex(ValueError, "must not exceed"):
            build_frames_workflow(
                prompt="Too large",
                width=864,
                height=512,
                duration_seconds=5,
                seed=1,
            )
        self.assertEqual(MAX_PIXELS, 480 * 864)

    def test_rejects_four_second_compatibility_duration(self):
        with self.assertRaisesRegex(ValueError, "between 5 and 15"):
            build_frames_workflow(
                prompt="Too short",
                width=864,
                height=480,
                duration_seconds=4,
                seed=1,
            )

    def test_accepts_png_bytes(self):
        png = self.png()
        self.assertEqual(validate_image_bytes(png), ".png")

    def test_rejects_unknown_image_type(self):
        with self.assertRaisesRegex(ValueError, "PNG, JPEG, or WebP"):
            validate_image_bytes(b"not an image")

    def test_reference_graph_preserves_global_mixed_order(self):
        references = [
            {
                "id": "new-audio",
                "kind": "audio",
                "slot": 0,
                "local_filename": "new.mp3",
                "tags": ["<Audio 1>"],
            },
            {
                "id": "image",
                "kind": "image",
                "slot": 0,
                "local_filename": "image.png",
                "tags": ["<Picture 1>"],
            },
            {
                "id": "old-video",
                "kind": "video",
                "slot": 0,
                "local_filename": "old.mp4",
                "use_audio": True,
                "tags": ["<Audio 2>", "<Video 1>"],
            },
        ]
        workflow = build_reference_workflow(
            prompt="Use the ordered references.",
            width=864,
            height=480,
            duration_seconds=5,
            seed=11,
            references=references,
        )
        self.assertEqual(
            workflow["model"]["inputs"]["unet_name"],
            "minimax_h3_ref2va_int8_convrot.safetensors",
        )
        self.assertEqual(
            workflow["conditioning"]["class_type"],
            "MiniMaxH3OrderedReferenceToVideo",
        )
        order = json.loads(workflow["conditioning"]["inputs"]["reference_order"])
        self.assertEqual([item["id"] for item in order], ["new-audio", "image", "old-video"])
        self.assertEqual(
            workflow["conditioning"]["inputs"]["ref_video_audio_0"],
            ["reference_components_2", 1],
        )
        self.assertEqual(workflow["load_reference_0"]["class_type"], "LoadAudio")
        self.assertEqual(workflow["turbo_lora"]["class_type"], "MiniMaxH3TurboLoRA")
        self.assertEqual(workflow["sampler"]["class_type"], "MiniMaxH3TurboSampler")

    def test_rejects_non_turbo_sampling_settings(self):
        with self.assertRaisesRegex(ValueError, "between 4 and 8"):
            build_frames_workflow(
                prompt="Too few steps",
                width=864,
                height=480,
                duration_seconds=5,
                seed=1,
                steps=3,
            )
        with self.assertRaisesRegex(ValueError, "minimax_h3_turbo"):
            build_frames_workflow(
                prompt="Wrong sampler",
                width=864,
                height=480,
                duration_seconds=5,
                seed=1,
                sampler="res_multistep",
            )

    def test_builds_base_sampling_graph_when_turbo_is_disabled(self):
        workflow = build_frames_workflow(
            prompt="A lighthouse in a storm.",
            width=864,
            height=480,
            duration_seconds=5,
            seed=42,
            turbo=False,
        )
        self.assertNotIn("turbo_lora", workflow)
        self.assertEqual(workflow["sampler"], {
            "class_type": "KSamplerSelect",
            "inputs": {"sampler_name": "res_multistep"},
        })
        self.assertEqual(workflow["scheduler"]["inputs"]["steps"], 20)
        self.assertEqual(workflow["scheduler"]["inputs"]["model"], ["model", 0])
        self.assertEqual(workflow["guider"]["inputs"]["model"], ["model", 0])


if __name__ == "__main__":
    unittest.main()
