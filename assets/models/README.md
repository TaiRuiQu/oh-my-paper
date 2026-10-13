# DocCornerNet document corner detector

`doccornernet-320.onnx` is exported from `checkpoints/best_320.pth` in [mapo80/DocCornerNet-Regression](https://github.com/mapo80/DocCornerNet-Regression/tree/e9b2566410cb3edd0ecd2081f58f8c9a9d865456), commit `e9b2566410cb3edd0ecd2081f58f8c9a9d865456` (MIT; notice in `LICENSE.DocCornerNet`).

- Checkpoint SHA-256: `78acf2879811aac0c4a197fcdd12acc8c3822bb2b1dc45c229b82d4e908f5154`
- Export SHA-256: `99bea32c919f5f78edd0695b50adfbfe9b231de291050470d08879d2533ce353`
- Input: float32 `[1,3,320,320]`, RGB / 255, ImageNet mean `[0.485,0.456,0.406]` and std `[0.229,0.224,0.225]`.
- Output: float32 `[1,9]`, normalized TL/TR/BR/BL coordinates followed by sigmoid document confidence.
- Export: upstream `export_onnx.py`, ONNX opset 13, Python 3.12, torch 2.6.0 CPU, torchvision 0.21.0 CPU, onnx 1.17.0. No pretrained-backbone download is needed.

To reproduce, check out the pinned commit and run:

```bash
python export_onnx.py --checkpoint checkpoints/best_320.pth --output doccornernet-320.onnx --opset 13
```

Runtime uses `cv2.dnn`, not PyTorch. Only detection uses a 320px image. Coordinates map to the original image before `warpPerspective`; native document edge lengths determine output dimensions. Inputs with flat scan borders, low confidence or invalid quadrilaterals retain all source pixels. Original uploads remain archived separately.
