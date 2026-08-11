import unittest
from unittest.mock import patch

from minimax_h3 import loras


class LoraConfigTests(unittest.TestCase):
    def entry(self, **changes):
        return {
            "id": "style",
            "name": "Style",
            "repo": "owner/repo",
            "source": "style.safetensors",
            "filename": "style.safetensors",
            "revision": "abc123",
            "default_enabled": False,
            "default_strength": 1.0,
            **changes,
        }

    def test_normalizes_local_catalog_and_download_spec(self):
        configured = loras.normalize_loras([self.entry()])
        with patch("minimax_h3.loras.CONFIGURED_LORAS", configured):
            self.assertEqual(loras.download_specs(), [
                ("owner/repo", "style.safetensors", "loras", "style.safetensors", "abc123")
            ])
            self.assertEqual(loras.resolve_lora_strengths({"style": 0.8}), {"style": 0.8})
            self.assertEqual(loras.resolve_lora_strengths({"style": 0}), {})

    def test_derives_catalog_fields_from_named_main_urls(self):
        configured = loras.normalize_loras({
            "Riding Pose v1.0": "https://huggingface.co/owner/repo/resolve/main/folder/pose.safetensors"
        })
        self.assertEqual(configured[0]["id"], "riding-pose-v1-0")
        self.assertEqual(configured[0]["repo"], "owner/repo")
        self.assertEqual(configured[0]["revision"], "main")
        self.assertEqual(configured[0]["source"], "folder/pose.safetensors")
        self.assertEqual(configured[0]["filename"], "pose.safetensors")
        self.assertFalse(configured[0]["default_enabled"])

    def test_rejects_unconfigured_and_out_of_range_loras(self):
        configured = loras.normalize_loras([self.entry()])
        with patch("minimax_h3.loras.CONFIGURED_LORAS", configured):
            with self.assertRaisesRegex(ValueError, "unknown or unavailable"):
                loras.resolve_lora_strengths({"missing": 1.0})
            with self.assertRaisesRegex(ValueError, "between 0.0 and 1.5"):
                loras.resolve_lora_strengths({"style": 2.0})

    def test_missing_local_catalog_has_no_public_ui_entries(self):
        with patch("minimax_h3.loras.CONFIGURED_LORAS", ()):
            self.assertEqual(loras.public_loras(), [])


if __name__ == "__main__":
    unittest.main()
