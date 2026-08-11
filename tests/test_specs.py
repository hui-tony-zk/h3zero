import unittest

from minimax_h3.specs import get_specs, native_canvas


class SpecsTests(unittest.TestCase):
    def test_authoritative_capabilities_snapshot(self):
        specs = get_specs()
        self.assertEqual(specs["version"], "1.6")
        self.assertTrue(specs["modes"]["references"]["available"])
        self.assertEqual(
            specs["modes"]["references"]["model"],
            "MiniMax-H3 Base FL2VA with reference conditioning",
        )
        self.assertEqual(
            specs["modes"]["references"]["checkpoint"],
            "minimax_h3_fl2va_int8_convrot.safetensors",
        )
        self.assertEqual(specs["modes"]["references"]["ref_image_size"]["default"], "match")
        self.assertEqual(specs["modes"]["references"]["order"], "upload_order")
        attachments = specs["modes"]["references"]["attachments"]
        self.assertEqual(attachments["max_sources"], 12)
        self.assertEqual(attachments["max_images"], 9)
        self.assertEqual(attachments["max_videos"], 3)
        self.assertEqual(attachments["max_audios"], 3)
        self.assertTrue(attachments["audio_may_not_be_sole_modality"])
        sampling = specs["output"]["sampling"]
        self.assertEqual(sampling["default"], "turbo_4")
        self.assertEqual(
            list(sampling["profiles"]),
            ["turbo_4", "turbo_8", "spectrum", "base"],
        )
        turbo = sampling["profiles"]["turbo_4"]
        spectrum = sampling["profiles"]["spectrum"]
        self.assertEqual(sampling["profiles"]["turbo_8"]["steps"]["default"], 8)
        self.assertEqual(sampling["profiles"]["base"]["steps"]["default"], 20)
        self.assertEqual(turbo["steps"], {"default": 4, "min": 4, "max": 4})
        self.assertEqual(turbo["sampler"], "res_multistep")
        self.assertEqual(
            turbo["lora"],
            "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
        )
        self.assertEqual(turbo["lora_strength"], 1.0)
        self.assertIsNone(turbo["low_vram"])
        self.assertTrue(spectrum["spectrum"])
        self.assertEqual(spectrum["steps"], {"default": 20, "min": 20, "max": 20})
        self.assertEqual(
            specs["output"]["seed"]["options"],
            [
                {"id": "random", "label": "Random", "value": None},
                {"id": "42", "label": "42", "value": 42},
                {"id": "106", "label": "106", "value": 106},
                {"id": "99", "label": "99", "value": 99},
            ],
        )

    def test_native_aspects_and_duration_grid(self):
        specs = get_specs()
        aspects = {
            item["id"]: (item["width"], item["height"])
            for item in specs["output"]["geometry"]["native_aspects"]
        }
        self.assertEqual(aspects, {
            "9:16": (480, 864),
            "16:9": (864, 480),
        })
        resolutions = specs["output"]["geometry"]["resolutions"]
        self.assertEqual(specs["output"]["geometry"]["default_resolution"], "480p")
        self.assertEqual(
            resolutions["768p"]["native_aspects"],
            [
                {"id": "9:16", "width": 768, "height": 1344},
                {"id": "16:9", "width": 1344, "height": 768},
            ],
        )
        self.assertTrue(resolutions["768p"]["recommended"])
        options = specs["output"]["duration"]["options"]
        self.assertEqual([item["requested_seconds"] for item in options], list(range(5, 16)))
        self.assertEqual(options[0]["frames"], 124)
        self.assertEqual(options[-1]["frames"], 362)
        self.assertNotIn("experimental", specs["output"]["duration"])
        self.assertEqual(native_canvas(1920, 1080), (864, 480))
        self.assertEqual(native_canvas(1920, 1080, "768p"), (1344, 768))


if __name__ == "__main__":
    unittest.main()
