# Setup Guide

## Prerequisites

1. Node.js 20+ (`node -v`)
2. k6 0.49+ / 2.x (`k6 version`)
3. Network access to staging/prod gateways
4. Valid auth credential (JWT Bearer recommended)

## Install

```powershell
cd C:\Users\nekumar\PerformanceTesting
npm install
```

## Environment segregation

| File | Purpose |
|------|---------|
| `performance/env/staging.env.example.json` | Safe template for staging |
| `performance/env/prod.env.example.json` | Safe template for production |
| `performance/env/staging.env.json` | Local staging secrets (gitignored) |
| `performance/env/prod.env.json` | Local prod secrets (gitignored) |

```powershell
copy performance\env\staging.env.example.json performance\env\staging.env.json
copy performance\env\prod.env.example.json performance\env\prod.env.json
```

Set at minimum:

- `BASE_URL` — API gateway root (no trailing slash)
- `AUTH_MODE` — `bearer` | `apikey` | `cookie` | `none`
- `AUTH_TOKEN` / `API_KEY` / `COOKIE` as applicable
- `ALLOW_PROD_RUN` — must be `true` for production runs

## Refresh API inventory from release specs

```powershell
node tools/generate-inventory.js
```

This re-reads `C:\Users\nekumar\Downloads\release\release\**\resolved_swagger.json` and updates:

- `performance/data/inventory/api-inventory.json`
- `performance/data/inventory/curated-get-suite.json`

## Verify

```powershell
npm run test:smoke:staging
npm run report:open
```
