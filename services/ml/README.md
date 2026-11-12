# ML Services

Place model serving and inference adapters in the relevant model domain. Keep model-specific dependencies out of the transactional API application.

## Ingredient detection

The local detector service loads the preferred EcoChef `best.pt` checkpoint once and serves YOLO inference on port 8001. Start it directly with:

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\scripts\Start-Ingredient-Detection.ps1
```

The normal `Start-Api.ps1` command starts this service automatically, points `INGREDIENT_DETECTION_API_URL` at it, and stops the child process when the API is stopped. If the detector cannot start, the scan endpoint falls back to Gemini when configured.

The current detector estimates item counts from YOLO boxes. Quantities, units, categories, and expiry dates remain editable in the mobile review screen.

## Freshness

No trained visual freshness checkpoint exists yet. Freshness scans therefore use Gemini. Once a serving endpoint is available, set `FRESHNESS_MODEL_API_URL`; the API already prefers that model and falls back to Gemini if the service is unavailable.
