# API Inventory

Generated from OpenAPI `resolved_swagger.json` under `Downloads/release`.

## Summary

| Environment | Services | GET APIs | Static GETs (no path params) |
|-------------|----------|----------|-------------------------------|
| staging | 10 | 1041 | 503 |
| prod | 10 | 1041 | 503 |

## Per-service GET inventory (staging ≈ prod)

| Service | GET count | Static | Path prefix |
|---------|-----------|--------|-------------|
| crm-pliportal-backend | 252 | 88 | `/becrmpliportal` |
| pliagent-backend | 193 | 121 | `/bepliagent` |
| ims_policyservices_backend | 170 | 38 | `/api` |
| ims-policyissue-backend | 145 | 97 | `/beimspolicyissue` |
| ims-datamigration-backend | 85 | 60 | `/beimsdatamigration` |
| ims-collections-backend | 74 | 37 | `/beimscollections` |
| ims_policymgmt_backend | 65 | 25 | `/api` |
| pli-claims-backend | 29 | 19 | `/bepliclaims` |
| pliproductmaster-backend | 28 | 18 | `/bepliprodmaster` |
| api-template-backend | 0 | 0 | — |

## Authentication findings

- Specs do **not** declare `securitySchemes` / global `security`
- Login/authorize-related paths exist in agent, collections, policy-issue services
- Framework default: **Bearer JWT** (`AUTH_MODE=bearer`) with API Key and Cookie adapters

## Headers / schemas

- Typical response envelopes: `APIResponse`, `APIErrorResponse`
- Default request headers: `Accept: application/json`, auth headers via utility
- Dependencies: many GETs require upstream IDs (policyNumber, session_id, claim id). Curated suite starts with static routes to avoid brittle coupling.

## Machine-readable files

- Full: `performance/data/inventory/api-inventory.json`
- Curated executable suite: `performance/data/inventory/curated-get-suite.json`
