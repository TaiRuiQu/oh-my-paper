"""DocCornerNet (320x320 ONNX) detection and original-resolution OpenCV scanning.

The model is from mapo80/DocCornerNet-Regression; see assets/models/README.md.
Detection never replaces the source pixels used by warpPerspective.
"""
import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np

cv2.setNumThreads(1)


def detect_corners(image, model_path):
    # Match upstream PIL/torchvision preprocessing: RGB, [0,1], ImageNet mean/std.
    small = cv2.resize(image, (320, 320), interpolation=cv2.INTER_LINEAR)
    rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    tensor = np.ascontiguousarray(((rgb - mean) / std).transpose(2, 0, 1)[None])
    net = cv2.dnn.readNetFromONNX(str(model_path))
    net.setInput(tensor)
    result = net.forward().reshape(-1)
    if result.size != 9 or not np.isfinite(result).all():
        raise ValueError("Invalid DocCornerNet output")
    # Export wrapper already applies sigmoid to the score.
    return result[:8].reshape(4, 2), float(result[8])


def valid_quad(points):
    points = np.asarray(points, dtype=np.float32)
    if points.shape != (4, 2) or not np.isfinite(points).all():
        return False
    if np.any(points < 0) or np.any(points > 1):
        return False
    if not cv2.isContourConvex(points):
        return False
    area = abs(cv2.contourArea(points))
    if not 0.18 <= area <= 1.0:
        return False
    edges = np.roll(points, -1, axis=0) - points
    lengths = np.linalg.norm(edges, axis=1)
    if np.min(lengths) < 0.08:
        return False
    # Reject folded/sliver quads and reversed or scrambled corner ordering.
    if cv2.contourArea(points, oriented=True) <= 0:
        return False
    for i in range(4):
        first = -edges[(i - 1) % 4]
        second = edges[i]
        cosine = np.dot(first, second) / (np.linalg.norm(first) * np.linalg.norm(second))
        angle = math.degrees(math.acos(float(np.clip(cosine, -1, 1))))
        if not 25 <= angle <= 155:
            return False
    return True


def full_page_scan(image):
    # Clean, nearly white borders indicate a digital/flat scan already filling the frame.
    # Protect answer-card registration marks and blank answer margins from CNN drift.
    height, width = image.shape[:2]
    band = max(1, round(min(height, width) * 0.006))
    edges = [image[:band], image[-band:], image[:, :band], image[:, -band:]]
    return all(float(np.mean(np.min(edge, axis=2) >= 220)) >= 0.98 for edge in edges)


def source_corners(normalized, width, height, margin=0.008):
    # Keep a small margin for regression error. Map the result to ORIGINAL dimensions.
    center = np.mean(normalized, axis=0)
    expanded = np.clip(center + (normalized - center) * (1 + margin * 2), 0, 1)
    return (expanded * np.array([width - 1, height - 1], dtype=np.float32)).astype(np.float32)


def warp_original(image, points):
    # The native edge lengths set output resolution; the 320px detector size is irrelevant.
    tl, tr, br, bl = np.asarray(points, dtype=np.float32)
    width = max(2, int(round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))) + 1)
    height = max(2, int(round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))) + 1)
    destination = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], np.float32)
    transform = cv2.getPerspectiveTransform(np.asarray(points, np.float32), destination)
    return cv2.warpPerspective(image, transform, (width, height), flags=cv2.INTER_CUBIC,
                               borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))


def enhance(image):
    # Mild local luminance contrast and sharpening retain colored markings and faint pencil.
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lab[:, :, 0] = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8)).apply(lab[:, :, 0])
    adjusted = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    softened = cv2.GaussianBlur(adjusted, (0, 0), 0.7)
    return cv2.addWeighted(adjusted, 1.12, softened, -0.12, 0)


def scan(image, model_path, detect=True, min_confidence=0.9):
    height, width = image.shape[:2]
    metadata = {"originalWidth": width, "originalHeight": height, "detectorSize": 320,
                "confidence": None, "corners": None, "corrected": False}
    normalized = None
    if not detect:
        metadata["reason"] = "rendered_pdf"
    elif full_page_scan(image):
        metadata["reason"] = "flat_scan"
    else:
        normalized, score = detect_corners(image, model_path)
        metadata["confidence"] = score
        if score < min_confidence:
            metadata["reason"] = "low_confidence"
        elif not valid_quad(normalized):
            metadata["reason"] = "invalid_corners"
        else:
            points = source_corners(normalized, width, height)
            image = warp_original(image, points)
            metadata.update({"corners": points.tolist(), "corrected": True, "reason": "corrected"})
    image = enhance(image)
    metadata.update({"width": image.shape[1], "height": image.shape[0]})
    return image, metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--skip-detection", action="store_true")
    args = parser.parse_args()
    # Inputs have been size-limited, flattened and EXIF-oriented by Sharp in the Worker.
    image = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode image")
    if not Path(args.model).is_file():
        raise FileNotFoundError("DocCornerNet model is missing")
    result, metadata = scan(image, args.model, detect=not args.skip_detection)
    if not cv2.imwrite(args.output, result, [cv2.IMWRITE_JPEG_QUALITY, 95]):
        raise OSError("Could not write scanned page")
    print(json.dumps(metadata, allow_nan=False))


if __name__ == "__main__":
    main()
