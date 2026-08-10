import unittest

from minimax_h3.progress import progress_from_comfy_event


class ProgressTests(unittest.TestCase):
    def test_turbo_lora_is_reported_as_model_loading(self):
        self.assertEqual(
            progress_from_comfy_event("executing", {"node": "turbo_lora"})["phase"],
            "loading",
        )

    def test_sampling_percent_is_truthful_and_phase_local(self):
        progress = progress_from_comfy_event(
            "progress_state",
            {"nodes": {"sample": {"state": "running", "value": 7, "max": 20}}},
        )
        self.assertEqual(progress["phase"], "sampling")
        self.assertEqual(progress["percent"], 0.35)

        decoding = progress_from_comfy_event("executing", {"node": "decode_video"})
        self.assertEqual(decoding["phase"], "decoding")
        self.assertNotIn("percent", decoding)

    def test_ignores_untruthful_or_irrelevant_updates(self):
        self.assertIsNone(
            progress_from_comfy_event(
                "progress_state",
                {"nodes": {"sample": {"state": "finished", "value": 20, "max": 20}}},
            )
        )
        self.assertIsNone(progress_from_comfy_event("executing", {"node": "noise"}))


if __name__ == "__main__":
    unittest.main()
