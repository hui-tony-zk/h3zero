import unittest

from minimax_h3.config import GPU_SCALEDOWN_WINDOW_SECONDS
from minimax_h3.runtime import (
    PYTORCH_CUDA_INDEX,
    PYTORCH_VERSION,
    SAGE_ATTENTION_COMMIT,
    SAGE_ATTENTION_VERSION,
    cuda_compatibility_error,
)


class RuntimeTests(unittest.TestCase):
    def test_personal_use_gpu_scaledown_is_thirty_seconds(self):
        self.assertEqual(GPU_SCALEDOWN_WINDOW_SECONDS, 30)

    def test_pins_blackwell_runtime_and_sage_attention(self):
        self.assertEqual(PYTORCH_VERSION, "2.11.0+cu130")
        self.assertTrue(PYTORCH_CUDA_INDEX.endswith("/cu130"))
        self.assertEqual(SAGE_ATTENTION_VERSION, "2.2.0")
        self.assertRegex(SAGE_ATTENTION_COMMIT, r"^[0-9a-f]{40}$")

    def test_accepts_cuda_13_sm120(self):
        self.assertIsNone(
            cuda_compatibility_error(
                cuda_version="13.0",
                capability=(12, 0),
                arch_list=["sm_90", "sm_120"],
            )
        )

    def test_rejects_the_crashing_cuda_126_wheel(self):
        error = cuda_compatibility_error(
            cuda_version="12.6",
            capability=(12, 0),
            arch_list=["sm_90"],
        )
        self.assertIn("CUDA 12.6", error)
        self.assertIn("CUDA 13.0", error)

    def test_rejects_wheel_without_sm120(self):
        error = cuda_compatibility_error(
            cuda_version="13.0",
            capability=(12, 0),
            arch_list=["sm_80", "sm_90"],
        )
        self.assertIn("does not contain sm_120", error)


if __name__ == "__main__":
    unittest.main()
