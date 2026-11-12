# EcoChef

EcoChef is a food-management platform with a consumer mobile app and role-based web portals for administrators and vendors.

This repository is intentionally a foundation only. It establishes ownership boundaries and feature locations before interface work begins.

## Applications

- `apps/mobile` — React Native consumer app for Android and iOS.
- `apps/web` — web portal with separate admin and vendor experiences after role-aware sign-in.
- `apps/api` — FastAPI application, business modules, jobs, and real-time APIs.

## Supporting services

- `services/ml` — independently deployable model-serving boundaries for spoilage, ingredient detection, and recommendations.
- `services/iot_gateway` — boundary for refrigerator sensor ingestion and event normalization.
- `packages/contracts` — shared API contracts and domain-safe types.
- `packages/api-client` — generated or handwritten typed API client for TypeScript apps.
- `infra` — deployment, container, and database migration concerns.

Read `docs/architecture/project-structure.md` before adding a feature.

Read `CONTRIBUTING.md` before making a change.

Read `docs/architecture/api-contracts.md` before adding or consuming an API endpoint.
