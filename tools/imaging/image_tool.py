"""Bounded image operations for the recognition agent; no model-generated code."""
import json
import sys
from PIL import Image, ImageOps, ImageEnhance

request = json.load(sys.stdin)
Image.MAX_IMAGE_PIXELS = 45_000_000
with Image.open(request["source"]) as source:
    image = source.convert("RGB")
    x, y, width, height = request["box"]
    image = image.crop((x, y, x + width, y + height))
    scale = request.get("scale", 1)
    if not isinstance(scale, (int, float)) or not 1 <= scale <= 4:
        raise ValueError("Invalid scale")
    factor = min(scale, 2800 / max(image.size))
    if factor != 1:
        image = image.resize((max(1, round(image.width * factor)), max(1, round(image.height * factor))), Image.Resampling.LANCZOS)
    operation = request["operation"]
    if operation == "autocontrast":
        image = ImageOps.autocontrast(image)
    elif operation == "threshold":
        import cv2
        import numpy as np
        gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
        image = Image.fromarray(cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11))
    elif operation == "sharpen":
        image = ImageEnhance.Sharpness(image).enhance(2)
    elif operation != "original":
        raise ValueError("Unsupported operation")
    image.thumbnail((2800, 2800))
    image.save(request["destination"], "PNG")
    print(json.dumps({"width": image.width, "height": image.height, "library": "OpenCV" if operation == "threshold" else "Pillow"}))
