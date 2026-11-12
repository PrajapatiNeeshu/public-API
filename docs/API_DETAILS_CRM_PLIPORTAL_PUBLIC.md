# API Details — CRM PLI Portal Public Suite

Filled per [`API_DETAILS_TEMPLATE.md`](./API_DETAILS_TEMPLATE.md) for the **collection** of swagger `x-public: true` APIs.

| Field | Value |
|-------|--------|
| Suite name | crm-pliportal-backend-public |
| Source | `crm-pliportal-backend/staging/resolved_swagger.json` |
| Filter | `x-public: true` |
| Count | **64** (20 GET + 44 POST) |
| Base URL | `https://imssit.indiapost.gov.in` (from `staging.env.json`) |
| Auth | Most `x-token-required: false`; bearer only if flagged |
| Path/query placeholders | `CRM_TEST_DATA` in env (`mobile_number`, `customer_id`, `pincode`, `office-id`) |
| POST body | Default `{}` stub until real payloads supplied |
| PASS_MODE | `no_5xx` (4xx counts as reachable for OTP stubs; TLS/5xx fail) |
| Peak users (load) | `CRM_STEP_VUS`: 1→5→10→25→50→100 |
| SLA default | P95 ≤ 1000 ms (CRM suite); success ≥ 99% under PASS_MODE |
| Inventory | `performance/apis-crm-pliportal.json` |
| Runner | `performance/run-crm-pliportal.js` |

## Sample endpoints

- `POST /becrmpliportal/v1/ap/otp/verify` — Verify Generic OTP (AP), `x-rate-limit: 5`
- `GET /becrmpliportal/v1/ap/offices/pincode-ho?pincode=…`
- Channel variants: `/ap/`, `/cg/`, `/cp/`, and root `/v1/`

## Commands

```powershell
npm run test:crm:once
npm run test:crm:smoke
npm run test:crm:load
```
