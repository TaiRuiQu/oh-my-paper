"""Geometry tests plus a real ONNX smoke test; no external services."""
import unittest
from pathlib import Path
from unittest.mock import patch
import cv2
import numpy as np
from scan import detect_corners, full_page_scan, scan, source_corners, valid_quad, warp_original

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / "assets/models/doccornernet-320.onnx"


class DocumentScanTests(unittest.TestCase):
    def test_maps_detection_to_native_pixels_and_preserves_fine_lines(self):
        image = np.full((3000, 4000, 3), 170, np.uint8)
        image[300:2701, 400:3601] = 255
        image[500:2500:2, 500:3500] = 0
        corners = source_corners(np.array([[.1, .1], [.9, .1], [.9, .9], [.1, .9]], np.float32), 4001, 3001, margin=0)
        np.testing.assert_allclose(corners, [[400, 300], [3600, 300], [3600, 2700], [400, 2700]], atol=.001)
        warped = warp_original(image, corners)
        self.assertEqual(warped.shape, (2401, 3201, 3))
        # Native one-pixel alternating lines survive; a 320px source warp cannot pass this.
        self.assertLess(float(warped[200:2200:2, 100:3100].mean()), 1)
        self.assertGreater(float(warped[201:2200:2, 100:3100].mean()), 254)

    def test_low_confidence_and_invalid_quads_keep_the_complete_page(self):
        image = np.full((600, 900, 3), 100, np.uint8)
        quad = np.array([[.1, .1], [.9, .1], [.9, .9], [.1, .9]], np.float32)
        with patch("scan.detect_corners", return_value=(quad, .5)):
            result, meta = scan(image, MODEL)
            self.assertEqual(result.shape, image.shape)
            self.assertEqual(meta["reason"], "low_confidence")
            self.assertFalse(meta["corrected"])
        quad[2] = quad[0]
        self.assertFalse(valid_quad(quad))
        with patch("scan.detect_corners", return_value=(quad, .99)):
            result, meta = scan(image, MODEL)
            self.assertEqual(result.shape, image.shape)
            self.assertEqual(meta["reason"], "invalid_corners")

    def test_flat_scans_and_rendered_pdfs_retain_dimensions(self):
        image = np.full((3200, 4800, 3), 255, np.uint8)
        image[200:3000, 200:4600] = 230
        self.assertTrue(full_page_scan(image))
        with patch("scan.detect_corners", side_effect=AssertionError("must not run")):
            result, meta = scan(image, MODEL)
            self.assertEqual(result.shape, image.shape)
            self.assertEqual(meta["reason"], "flat_scan")
            result, meta = scan(image, MODEL, detect=False)
            self.assertEqual(result.shape, image.shape)
            self.assertEqual(meta["reason"], "rendered_pdf")

    def test_real_model_detects_example_photograph_and_warps_at_native_scale(self):
        image = cv2.imread(str(ROOT / "examples/生物_试题_学生作答_照片.jpg"))
        quad, confidence = detect_corners(image, MODEL)
        self.assertGreater(confidence, .9)
        self.assertTrue(valid_quad(quad))
        result, meta = scan(image, MODEL)
        self.assertTrue(meta["corrected"])
        self.assertGreater(result.shape[0], 1500)
        self.assertGreater(result.shape[1], 1100)
        self.assertEqual(meta["originalWidth"], image.shape[1])
        # The colored teacher/student annotations remain colored after enhancement.
        red = (result[:, :, 2].astype(int) - result[:, :, 0].astype(int)) > 30
        self.assertGreater(int(red.sum()), 500)


if __name__ == "__main__":
    unittest.main()
