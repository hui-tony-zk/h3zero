import unittest
from unittest.mock import patch

from minimax_h3.comfy import COMFY_DIR, WEBSOCKET_TIMEOUT_SECONDS, start_comfyui


class ComfyStartupTests(unittest.TestCase):
    def test_websocket_allows_long_silent_sampling_steps(self):
        self.assertEqual(WEBSOCKET_TIMEOUT_SECONDS, 120)

    @patch("minimax_h3.comfy.subprocess.Popen")
    def test_starts_without_highvram_and_with_sage_attention(self, popen):
        start_comfyui(8199)

        command = popen.call_args.args[0]
        self.assertNotIn("--highvram", command)
        self.assertIn("--use-sage-attention", command)
        self.assertEqual(popen.call_args.kwargs["cwd"], COMFY_DIR)


if __name__ == "__main__":
    unittest.main()
