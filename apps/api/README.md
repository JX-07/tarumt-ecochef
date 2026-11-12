# API

FastAPI modular monolith. Add a domain module before adding endpoints, not after.

## Local commands

From the repository root, run `powershell -ExecutionPolicy Bypass -File infra/scripts/Setup-Api.ps1` once, then start the API without pnpm:

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\scripts\Start-Api.ps1
```

Health endpoints:

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`
- `GET /api/v1/docs`

## Scan model integration

`POST /api/v1/scans/ingredients` and `POST /api/v1/scans/freshness` accept a base64 image and MIME type. By default they use the configured Gemini model. Set either URL below to prefer a trained inference service instead:

- `INGREDIENT_DETECTION_API_URL`
- `FRESHNESS_MODEL_API_URL`

EcoChef sends the service `{ "data": "<base64>", "content_type": "image/jpeg" }`. The ingredient service returns an `items` array containing `name`, `confidence` (0–1), `suggested_amount`, `suggested_unit`, `suggested_expiry_days`, and optional `category`. The freshness service returns an `items` array containing `name`, `status` (`fresh`, `use_soon`, `spoiled`, or `unknown`), `confidence`, `finding`, `spoilage_reasons`, `prevention`, `safe_to_consume`, and `safety_note`.

For local development, `infra/scripts/Start-Api.ps1` automatically starts the trained YOLO ingredient service from `services/ai_training/runs/detector_yolo26s_accurate_all_sources/train/weights/best.pt`. Pass `-SkipIngredientDetector` to disable it. Freshness remains on Gemini until its first trained model is deployed.
