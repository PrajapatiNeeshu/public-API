# Troubleshooting Guide

## `BASE_URL is required`

Set `BASE_URL` in `performance/env/<env>.env.json` or export before run.

## `Production runs blocked`

Set `"ALLOW_PROD_RUN": "true"` only for intentional prod tests.

## `k6` not found

Refresh PATH or reinstall:

```powershell
winget install GrafanaLabs.k6 --source winget
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
```

## 401 / 403 on all endpoints

1. Confirm `AUTH_MODE`
2. Confirm token/api key/cookie validity
3. Confirm gateway expects `Authorization: Bearer <token>`

## High latency only on some services

Use report tags (`service`, `endpoint`) to isolate hot services.  
Likely candidates: CRM portal (252 GETs), agent backend, policy services.

## Report not generated

Ensure run is launched via `performance/runner/run.js` so `K6_REPORTS_DIR` points to an absolute reports folder.

## Inventory out of date

```powershell
node tools/generate-inventory.js
```
