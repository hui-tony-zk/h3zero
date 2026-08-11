import unittest
import json
from unittest.mock import patch

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
        self.assertEqual(workflow["turbo_lora"]["class_type"], "LoraLoaderModelOnly")
        self.assertEqual(workflow["turbo_lora"]["inputs"], {
            "model": ["model", 0],
            "lora_name": "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
            "strength_model": 1.0,
        })
        self.assertEqual(workflow["sampler"], {
            "class_type": "KSamplerSelect",
            "inputs": {"sampler_name": "res_multistep"},
        })
        self.assertEqual(workflow["scheduler"]["inputs"]["steps"], 4)
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

    def test_builds_eight_step_and_spectrum_rnd_profiles(self):
        turbo_8 = build_frames_workflow(
            prompt="Eight-step comparison.",
            width=864,
            height=480,
            duration_seconds=5,
            seed=42,
            sampling_profile="turbo_8",
        )
        self.assertEqual(
            turbo_8["turbo_lora"]["inputs"]["lora_name"],
            "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
        )
        self.assertEqual(turbo_8["scheduler"]["inputs"]["steps"], 8)

        spectrum = build_frames_workflow(
            prompt="Spectrum comparison.",
            width=864,
            height=480,
            duration_seconds=5,
            seed=106,
            sampling_profile="spectrum",
        )
        self.assertNotIn("turbo_lora", spectrum)
        self.assertEqual(spectrum["spectrum"]["class_type"], "SpectrumApplyMiniMaxH3")
        self.assertTrue(spectrum["spectrum"]["inputs"]["offline_smoothing_replay"])
        self.assertEqual(spectrum["spectrum"]["inputs"]["audio_blend_weight"], 0.0)
        self.assertEqual(spectrum["scheduler"]["inputs"]["steps"], 20)
        self.assertEqual(spectrum["scheduler"]["inputs"]["model"], ["spectrum", 0])

    def test_rejects_oversized_canvas(self):
        with self.assertRaisesRegex(ValueError, "must not exceed"):
            build_frames_workflow(
                prompt="Too large",
                width=864,
                height=512,
                duration_seconds=5,
                seed=1,
            )
        self.assertEqual(MAX_PIXELS, 768 * 1344)

    def test_accepts_recommended_768p_canvas(self):
        workflow = build_frames_workflow(
            prompt="High resolution",
            width=1344,
            height=768,
            duration_seconds=5,
            seed=42,
            resolution="768p",
        )
        self.assertEqual(
            (workflow["conditioning"]["inputs"]["width"], workflow["conditioning"]["inputs"]["height"]),
            (1344, 768),
        )

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
            "minimax_h3_fl2va_int8_convrot.safetensors",
        )
        self.assertEqual(workflow["conditioning"]["inputs"]["ref_image_size"], "match")
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
        self.assertEqual(workflow["turbo_lora"]["class_type"], "LoraLoaderModelOnly")
        self.assertEqual(workflow["sampler"]["class_type"], "KSamplerSelect")

    def test_rejects_non_turbo_sampling_settings(self):
        with self.assertRaisesRegex(ValueError, "steps must be 4"):
            build_frames_workflow(
                prompt="Too few steps",
                width=864,
                height=480,
                duration_seconds=5,
                seed=1,
                steps=3,
            )
        with self.assertRaisesRegex(ValueError, "res_multistep"):
            build_frames_workflow(
                prompt="Wrong sampler",
                width=864,
                height=480,
                duration_seconds=5,
                seed=1,
                sampler="minimax_h3_turbo",
            )

    def test_builds_spectrum_sampling_graph_when_turbo_is_disabled(self):
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
        self.assertEqual(workflow["scheduler"]["inputs"]["model"], ["spectrum", 0])
        self.assertEqual(workflow["guider"]["inputs"]["model"], ["spectrum", 0])

    def test_optional_style_lora_is_chained_after_turbo(self):
        configured = ({
            "id": "pose",
            "name": "Pose",
            "filename": "pose.safetensors",
            "default_enabled": False,
            "default_strength": 1.0,
            "min_strength": 0.0,
            "max_strength": 1.5,
            "step": 0.1,
            "repo": "owner/repo",
            "source": "pose.safetensors",
            "revision": "abc",
            "prompt": None,
        },)
        with (
            patch("minimax_h3.loras.CONFIGURED_LORAS", configured),
            patch("minimax_h3.workflow.CONFIGURED_LORAS", configured),
        ):
            workflow = build_frames_workflow(
                prompt="A rider holds the pose.",
                width=864,
                height=480,
                duration_seconds=5,
                seed=42,
                loras={"pose": 0.7},
            )
        self.assertEqual(workflow["style_lora_0"], {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["turbo_lora", 0],
                "lora_name": "pose.safetensors",
                "strength_model": 0.7,
            },
        })
        self.assertEqual(workflow["scheduler"]["inputs"]["model"], ["style_lora_0", 0])
        self.assertEqual(workflow["guider"]["inputs"]["model"], ["style_lora_0", 0])


if __name__ == "__main__":
    unittest.main()
