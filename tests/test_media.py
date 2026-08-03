import unittest

from minimax_h3.media import image_dimensions


class MediaTests(unittest.TestCase):
    def test_reads_png_dimensions_without_decoding_on_gpu(self):
        raw = (
            b"\x89PNG\r\n\x1a\n"
            + b"\x00\x00\x00\rIHDR"
            + (1920).to_bytes(4, "big")
            + (1080).to_bytes(4, "big")
        )
        self.assertEqual(image_dimensions(raw), (1920, 1080))

    def test_rejects_truncated_image(self):
        with self.assertRaisesRegex(ValueError, "invalid PNG"):
            image_dimensions(b"\x89PNG\r\n\x1a\n")


if __name__ == "__main__":
    unittest.main()
