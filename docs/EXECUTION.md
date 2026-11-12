# Execution Guide

> Framework changes must follow **[SDD.md](./SDD.md)** (Spec-Driven Development). Do not modify unrelated modules for a single request.

## CRM PLI Portal public APIs (`x-public: true`)

| Scenario | Command |
|----------|---------|
| Once (functional + response report) | `npm run test:crm:once` |
| Smoke | `npm run test:crm:smoke` |
| Load (step-up) | `npm run test:crm:load` |

Inventory: `performance/apis-crm-pliportal.json` (64 public APIs from crm-pliportal-backend swagger).

## Scenario matrix

| Scenario | Profile | Command |
|----------|---------|---------|
| Smoke | 1 VU / 5m | `npm run test:smoke:staging` |
| Baseline | 10 VUs / 15m | `npm run test:baseline:staging` |
| Load | Ramp 10m to 100 VU, sustain 30m | `npm run test:load:staging` |
| Stress | Ramp to 2000 VUs | `npm run test:stress:staging` |
| Spike | Burst to 500 VUs | `npm run test:spike:staging` |
| Soak | 50 VUs / 12h | `npm run test:soak:staging` |

Replace `staging` with `prod` for production (guarded).

## Runner

```powershell
node performance/runner/run.js --env=staging --scenario=smoke
```

The runner:

1. Loads env-specific JSON config
2. Blocks prod unless `ALLOW_PROD_RUN=true`
3. Injects env vars into k6
4. Writes reports under `performance/reports/`

## Assertions applied every request

- HTTP status == 200
- Response time < 500ms (check)
- Aggregate error rate < 1% (threshold; stress/spike relaxed)
- Availability/checks rate > 99% (threshold)

## Reports generated

For each run:

- `*.html` — animated modern report
- `*.json` — machine-readable summary
- `*.csv` — latency/throughput export

View UI:

```powershell
npm run report:ui
```
