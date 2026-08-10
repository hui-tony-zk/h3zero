import unittest

from minimax_h3.specs import get_specs, native_canvas


class SpecsTests(unittest.TestCase):
    def test_authoritative_capabilities_snapshot(self):
        specs = get_specs()
        self.assertEqual(specs["version"], "1.1")
        self.assertTrue(specs["modes"]["references"]["available"])
        self.assertEqual(specs["modes"]["references"]["order"], "upload_order")
        attachments = specs["modes"]["references"]["attachments"]
        self.assertEqual(attachments["max_sources"], 12)
        self.assertEqual(attachments["max_images"], 9)
        self.assertEqual(attachments["max_videos"], 3)
        self.assertEqual(attachments["max_audios"], 3)
        self.assertTrue(attachments["audio_may_not_be_sole_modality"])
        sampling = specs["output"]["sampling"]
        self.assertEqual(sampling["steps"], {"default": 8, "min": 4, "max": 8})
        self.assertEqual(sampling["sampler"], "minimax_h3_turbo")
        self.assertEqual(
            sampling["lora"],
            "minimax_h3_turbo_v4_step600_ema.safetensors",
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
        options = specs["output"]["duration"]["options"]
        self.assertEqual([item["requested_seconds"] for item in options], list(range(5, 16)))
        self.assertEqual(options[0]["frames"], 124)
        self.assertEqual(options[-1]["frames"], 362)
        self.assertNotIn("experimental", specs["output"]["duration"])
        self.assertEqual(native_canvas(1920, 1080), (864, 480))


if __name__ == "__main__":
    unittest.main()
