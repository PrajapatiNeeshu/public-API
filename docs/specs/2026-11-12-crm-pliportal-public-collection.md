# Spec: CRM PLI Portal public API performance collection
Date: 2026-11-12
Request: From crm-pliportal-backend staging swagger, take all `x-public: true` APIs (64 matches) and create a separate crm-pliportal-backend collection for API performance testing. Follow SDD + MASTER_PROMPT + API_DETAILS_TEMPLATE.

## Intent
Add an isolated inventory + runner for CRM PLI Portal **public** APIs so functional-once and performance (smoke/load) can target them without mixing into agents or other services.

## In scope
- files:
  - `performance/apis-crm-pliportal.json` (inventory)
  - `performance/run-crm-pliportal.js` (once / smoke / load)
  - `package.json` scripts only for this suite
  - `docs/SDD.md` ownership row
  - this mini-spec
- behavior: extract `x-public: true` operations; generate func+perf via existing report-template

## Out of scope
- Changing `run-agents.js`, `apis-agents.json`, generic `apis.json`
- Rewriting report-template
- Calling real OTP / mutating prod
- Backend swagger edits

## Acceptance
- [x] Inventory lists public CRM APIs with method/path/auth/rate-limit (64)
- [x] `test:crm:once|smoke|load` scripts + runner + report-template wiring
- [x] smoke/load scripts exist
- [x] Unrelated suites untouched (`run-agents.js` / `apis-agents.json` not modified)

## Risks
- Many public APIs are POST (OTP, etc.) and need payloads / may be rate-limited (`x-rate-limit`)
- Some may return 4xx without body — still useful for connectivity/perf of gateway path

## Verify
`npm run test:crm:once`
