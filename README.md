# PLI / IMS – Simple Performance Testing

This folder has:

1. **API specs** → each `*-backend` folder (`staging` / `prod`)
2. **K6 tests** → `performance/` (simple framework)

## Folder structure

```text
release/
├── pliagent-backend/          ← swagger specs
├── crm-pliportal-backend/
├── ...
├── performance/               ← performance tests only
│   ├── staging.env.json       ← staging URL + token
│   ├── prod.env.json          ← prod URL + token
│   ├── apis.json              ← GET APIs to test
│   ├── helpers.js             ← shared helpers
│   ├── test.js                ← k6 test script
│   ├── run.js                 ← runner
│   └── reports/
│       ├── staging/
│       └── prod/
├── package.json
└── README.md
```

## How to run (3 steps)

```powershell
cd C:\Users\nekumar\Downloads\release\release
npm install
```

1. Edit `performance/staging.env.json`
   - set real `BASE_URL`
   - set real `AUTH_TOKEN`

2. Run a test:

```powershell
npm run test:smoke:staging
```

3. Open report:

`performance/reports/staging/pli-staging-smoke.html`

## All commands

| Test | Staging | Prod |
|------|---------|------|
| Smoke (1 VU, 5m) | `npm run test:smoke:staging` | `npm run test:smoke:prod` |
| Baseline (10 VU, 15m) | `npm run test:baseline:staging` | — |
| Load (100 VU) | `npm run test:load:staging` | `npm run test:load:prod` |
| Stress | `npm run test:stress:staging` | `npm run test:stress:prod` |
| Spike | `npm run test:spike:staging` | `npm run test:spike:prod` |
| Soak (12h) | `npm run test:soak:staging` | `npm run test:soak:prod` |

Prod needs `"ALLOW_PROD_RUN": "true"` in `performance/prod.env.json`.

## SLA targets

- P95 < 500ms
- P99 < 1000ms
- Error rate < 1%

## Add more APIs

Edit `performance/apis.json`:

```json
[
  { "service": "pliagent-backend", "path": "/bepliagent/v1/agent-types" }
]
```
