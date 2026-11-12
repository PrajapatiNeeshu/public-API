# Mini-spec: CRM all GET APIs + Bearer for private

## Request
User provided staging JWT. Update CRM suite so private GET APIs use the token, expand inventory beyond x-public-only, run all CRM GET APIs.

## Module (SDD §3)
CRM PLI Portal suite — `apis-crm-pliportal.json`, `run-crm-pliportal.js`, `CRM_*` / `AUTH_TOKEN` in `staging.env.json`.

## Behavior
1. Inventory includes **all** swagger GET paths (public + private), not only `x-public`.
2. Private GETs (`xPublic: false`) set `xTokenRequired: true`; runner sends `Authorization: Bearer` when token configured.
3. Public GETs remain callable without token (unless marked token-required).
4. POSTs stay disabled until payloads provided.
5. Verify with `npm run test:crm:once` (smallest scenario).

## Out of scope
Agents suite, POST enablement, load ramp / P95 gate changes, production env.
