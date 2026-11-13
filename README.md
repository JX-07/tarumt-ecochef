# EcoChef

EcoChef has a consumer mobile app, vendor and administrator web portals, and a FastAPI backend.

## Repository map

| Path                     | Purpose                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `apps/mobile`            | Expo Router app for Android and iOS. Routes live in `app/`; feature code lives in `src/features/`. |
| `apps/web`               | Next.js vendor and administrator portals.                                                          |
| `apps/api`               | FastAPI endpoints, domain services, and database access.                                           |
| `packages/contracts`     | Shared TypeScript API types.                                                                       |
| `packages/api-client`    | Typed client helpers.                                                                              |
| `packages/design-tokens` | Shared colours, typography, and spacing.                                                           |
| `services/ai_training`   | Model training and dataset preparation.                                                            |
| `services/ml`            | Model inference services.                                                                          |
| `services/iot_gateway`   | Refrigerator sensor integration.                                                                   |
| `infra`                  | Railway deployment, scripts, and database migrations.                                              |

## Local development

Install JavaScript dependencies with `pnpm install`, then set up the API with `powershell -ExecutionPolicy Bypass -File .\infra\scripts\Setup-Api.ps1`. Configure each app using its `.env.example` file.

From the repository root, start the API and web portal in separate PowerShell terminals:

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\scripts\Start-Api.ps1
powershell -ExecutionPolicy Bypass -File .\infra\scripts\Start-Web.ps1
```

For mobile development, run `pnpm dev:mobile`. See [mobile setup](apps/mobile/README.md) for emulator and device networking. See [Railway setup](infra/RAILWAY.md) for hosted services.

## Formatting and checks

Prettier formats the web app, mobile app, shared packages, JSON, CSS, and Markdown. Ruff formats Python; Prettier does not support Python. Existing database migrations remain as applied SQL history.

```powershell
pnpm format
pnpm format:check
apps/api/.venv/Scripts/ruff.exe format .
apps/api/.venv/Scripts/ruff.exe format --check .
pnpm check
```
