"""Local HTTP inference adapter for EcoChef's trained YOLO ingredient detector."""

from __future__ import annotations

import argparse
import base64
import binascii
import io
import json
import os
import threading
from collections import defaultdict
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import torch
from PIL import Image, UnidentifiedImageError
from ultralytics import YOLO


SERVICE_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = SERVICE_ROOT.parents[2]
DEFAULT_CHECKPOINTS = (
    REPOSITORY_ROOT / "services/ai_training/runs/detector_yolo26s_accurate_all_sources/train/weights/best.pt",
    REPOSITORY_ROOT / "services/ai_training/runs/detector_yolo26s/train/weights/best.pt",
    REPOSITORY_ROOT / "services/ai_training/runs/detector/train/weights/best.pt",
)
MAX_REQUEST_BYTES = 14 * 1024 * 1024
MAX_IMAGE_PIXELS = 30_000_000

DISPLAY_NAMES = {
    "green_vegetables": "Leafy greens",
    "hamimelon": "Hami melon",
    "kiwi_fruit": "Kiwi",
    "meat_ball": "Meatballs",
    "orange_tangerine": "Orange or tangerine",
    "other_fish": "Fish",
}
PANTRY = {"bread", "chocolate", "dates", "flour", "nuts", "pasta", "pistachio", "rice"}
SEAFOOD = {"crab", "fish", "lobster", "oyster", "scallop", "shrimp"}
MEAT = {"chicken", "duck", "meatballs", "mutton", "sausage", "steak"}
DAIRY = {"butter", "cheese", "cream", "milk"}
LEAFY = {"asparagus", "celery", "green beans", "green onion", "leafy greens", "lettuce", "spinach"}


def checkpoint_path(explicit: str | None = None) -> Path:
    configured = explicit or os.getenv("ECOCHEF_DETECTOR_MODEL_PATH")
    if configured:
        candidate = Path(configured).expanduser().resolve()
        if not candidate.is_file():
            raise FileNotFoundError(f"Detector checkpoint not found: {candidate}")
        return candidate
    for candidate in DEFAULT_CHECKPOINTS:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("No trained detector checkpoint was found under services/ai_training/runs.")


def clean_name(raw_name: str) -> str:
    return DISPLAY_NAMES.get(raw_name, raw_name.replace("_", " ").strip().title())


def metadata_for(name: str, count: int) -> dict[str, Any]:
    normalized = name.casefold()
    if normalized in PANTRY:
        return {"suggested_amount": count, "suggested_unit": "packs", "suggested_expiry_days": 30, "category": "Pantry"}
    if normalized in SEAFOOD:
        return {"suggested_amount": count, "suggested_unit": "pcs", "suggested_expiry_days": 2, "category": "Seafood"}
    if normalized in MEAT:
        return {"suggested_amount": count, "suggested_unit": "pcs", "suggested_expiry_days": 2, "category": "Meat"}
    if normalized in DAIRY:
        return {"suggested_amount": count, "suggested_unit": "packs", "suggested_expiry_days": 7, "category": "Dairy"}
    if normalized == "egg":
        return {"suggested_amount": count, "suggested_unit": "pcs", "suggested_expiry_days": 21, "category": "Dairy & eggs"}
    if normalized in LEAFY:
        return {"suggested_amount": count, "suggested_unit": "bunch", "suggested_expiry_days": 4, "category": "Vegetables"}
    return {"suggested_amount": count, "suggested_unit": "pcs", "suggested_expiry_days": 7, "category": "Produce"}


class IngredientDetector:
    def __init__(self, weights: Path, confidence: float, image_size: int) -> None:
        self.weights = weights
        self.confidence = confidence
        self.image_size = image_size
        self.device = "0" if torch.cuda.is_available() else "cpu"
        self.model = YOLO(str(weights))
        self.lock = threading.Lock()

    def detect(self, image: Image.Image) -> dict[str, Any]:
        with self.lock, torch.inference_mode():
            prediction = self.model.predict(
                source=image,
                conf=self.confidence,
                iou=0.55,
                imgsz=self.image_size,
                max_det=100,
                device=self.device,
                verbose=False,
            )[0]
        grouped: dict[str, list[float]] = defaultdict(list)
        boxes: list[dict[str, Any]] = []
        if prediction.boxes is not None:
            for box in prediction.boxes:
                class_id = int(box.cls.item())
                confidence = float(box.conf.item())
                raw_name = str(prediction.names[class_id])
                name = clean_name(raw_name)
                grouped[name].append(confidence)
                coordinates = [round(float(value), 2) for value in box.xyxy[0].tolist()]
                boxes.append({"name": name, "confidence": round(confidence, 4), "xyxy": coordinates})
        items = []
        for name, confidences in sorted(grouped.items(), key=lambda entry: max(entry[1]), reverse=True):
            items.append({
                "name": name,
                "confidence": round(max(confidences), 4),
                **metadata_for(name, len(confidences)),
            })
        return {
            "items": items,
            "detections": boxes,
            "model": {
                "checkpoint": self.weights.name,
                "device": "cuda" if self.device == "0" else "cpu",
                "confidence_threshold": self.confidence,
            },
        }


def decode_image(payload: dict[str, Any]) -> Image.Image:
    data = payload.get("data")
    content_type = payload.get("content_type")
    if not isinstance(data, str) or content_type not in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
        raise ValueError("A base64 JPEG, PNG, or WebP image is required.")
    try:
        image_bytes = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("The image data is not valid base64.") from error
    if len(image_bytes) > 10 * 1024 * 1024:
        raise ValueError("The image must be smaller than 10 MB.")
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
    except (UnidentifiedImageError, OSError) as error:
        raise ValueError("The uploaded data is not a readable image.") from error
    if image.width * image.height > MAX_IMAGE_PIXELS:
        raise ValueError("The image dimensions are too large.")
    return image.convert("RGB")


def handler_for(detector: IngredientDetector) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "EcoChefIngredientDetector/1.0"

        def _json(self, status_code: HTTPStatus, body: dict[str, Any]) -> None:
            encoded = json.dumps(body).encode("utf-8")
            self.send_response(status_code.value)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_GET(self) -> None:  # noqa: N802
            if self.path != "/health":
                self._json(HTTPStatus.NOT_FOUND, {"detail": "Not found."})
                return
            self._json(HTTPStatus.OK, {
                "status": "ready",
                "checkpoint": str(detector.weights),
                "device": "cuda" if detector.device == "0" else "cpu",
            })

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/v1/detect":
                self._json(HTTPStatus.NOT_FOUND, {"detail": "Not found."})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > MAX_REQUEST_BYTES:
                    raise ValueError("The request is empty or too large.")
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                self._json(HTTPStatus.OK, detector.detect(decode_image(payload)))
            except (ValueError, json.JSONDecodeError) as error:
                self._json(HTTPStatus.UNPROCESSABLE_ENTITY, {"detail": str(error)})
            except Exception as error:  # The API receives a safe error without a server traceback.
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"detail": f"Inference failed: {type(error).__name__}"})

        def log_message(self, message_format: str, *args: object) -> None:
            print(f"{self.address_string()} - {message_format % args}", flush=True)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve EcoChef ingredient detection inference.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--weights")
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument("--image-size", type=int, default=768)
    args = parser.parse_args()
    if not 0 < args.confidence <= 1:
        parser.error("--confidence must be between 0 and 1.")
    weights = checkpoint_path(args.weights)
    print(f"Loading EcoChef detector from {weights}", flush=True)
    detector = IngredientDetector(weights, args.confidence, args.image_size)
    server = ThreadingHTTPServer((args.host, args.port), handler_for(detector))
    print(f"Ingredient detector ready at http://{args.host}:{args.port} using {detector.device}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
