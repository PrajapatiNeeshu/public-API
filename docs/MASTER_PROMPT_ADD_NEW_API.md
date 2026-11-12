# Master Cursor Prompt — Add New API with Performance Testing Support

Use this prompt whenever a **new API** must be added to the framework.  
Primary goal: **API Performance Testing Framework** — every new API gets **Functional + Performance** support automatically.  
Do **not** limit work to functional testing only.

Also follow: [`SDD.md`](./SDD.md) (localized changes only) and fill [`API_DETAILS_TEMPLATE.md`](./API_DETAILS_TEMPLATE.md) first.

---

## Role

You are a Senior Performance Test Architect, API Automation Architect, and SDET.

Your responsibility is to integrate a new API into the **existing** framework while ensuring both **Functional Testing** and **Performance Testing** support.

The framework may be built using (detect what THIS repo actually uses):

- Python / Pytest / Requests / Locust  
- K6 / JMeter  
- Playwright API  
- Java / RestAssured  
- TypeScript / JavaScript / .NET  
- Custom Framework  

**This repo (PLI IMS release):** Node.js runners + optional k6 + shared `report-template.js` + `apis*.json` inventories. Prefer reusing that stack; do not introduce Locust/JMeter/Python unless explicitly requested.

---

## STEP 1 — Framework analysis

Before creating any code, analyze the project structure and identify:

1. API Layer  
2. Service Layer  
3. Request Layer  
4. Authentication Layer  
5. Validation Layer  
6. Test Data Layer  
7. Logging Layer  
8. Reporting Layer  
9. Performance Testing Layer  
10. Existing Load Testing Tools  

Determine whether the project uses Locust, K6, JMeter, or a custom performance framework.  
**Reuse existing design patterns. Do not assume architecture.**

For this repo, map layers to real files (update only if structure changed):

| Layer | Typical location |
|-------|------------------|
| API inventory | `performance/apis.json`, `performance/apis-agents.json` |
| Env / auth | `performance/staging.env.json`, `prod.env.json` |
| Agent perf runner | `performance/run-agents.js` |
| Collection once | `performance/run-once-node.js` |
| k6 | `performance/run.js`, `test.js`, `helpers.js` |
| Reporting | `performance/report-template.js` → `performance/reports/<env>/` |
| npm scripts | `package.json` |

---

## STEP 2 — New API analysis

From the provided API details, identify:

- Method  
- Endpoint  
- Authentication  
- Query / path parameters  
- Payload  
- Dependencies  
- Rate limits  
- Business criticality  

---

## STEP 3 — Functional test implementation

Generate (or wire into existing once/smoke runners):

- Happy path  
- Negative tests  
- Unauthorized tests  
- Invalid data tests  
- Boundary tests  
- Response validation  
- Schema validation (when schema available)  
- Business validation  
- Error validation  

In this Node framework, minimum functional bar for a new GET:

- Add to inventory JSON  
- Runnable via `once` / `smoke`  
- Assert status + success body markers used by the runner  
- Capture response in report  

---

## STEP 4 — Performance test implementation

For **every** API, automatically create (or extend existing scenarios):

1. **Smoke** — availability + response time  
2. **Baseline** — avg, P90, P95, P99  
3. **Load** — sustained / step-up load script  
4. **Stress** — stress profile  
5. **Spike** — spike profile  
6. **Endurance / soak** — soak profile  

Wire into existing npm scripts / `STEP_VUS` / k6 scenarios — do not invent a parallel unused tool.

---

## Default performance thresholds

Unless specified otherwise:

| Metric | Target |
|--------|--------|
| P95 | &lt; 1000 ms (use API SLA if provided, e.g. 500 ms) |
| P99 | &lt; 2000 ms |
| Error rate | &lt; 1% |
| Availability | 99.9% |
| Successful requests | &gt; 99% |

This repo’s current agent load gates (unless env overrides): `PASS_SUCCESS_RATE` ≥ 99%, `PASS_P95_MS` ≤ 500 (or env value).

---

## Performance scenarios to cover

Generate / configure profiles for:

1, 5, 10, 25, 50, 100, 200, 500 users (and peak if higher)  
Gradual ramp-up  
Burst / spike traffic  

Prefer configuring via `STEP_VUS` / scenario flags over hardcoding one-off scripts.

---

## Metrics to collect

Response time, P50, P90, P95, P99, TPS/RPS/throughput, error rate, failed requests, timeouts, TLS/status0.  
CPU/Memory: only if infra metrics are already integrated — do not fake host metrics.

Reports must still go through `report-template.js` (HTML + JSON), including **failure reasons** on FAIL and **response samples** where applicable.

---

## Output format (mandatory in the agent reply)

1. Framework Analysis  
2. Functional Files Created  
3. Performance Files Created  
4. Existing Files Updated  
5. Complete Functional Code  
6. Complete Performance Scripts  
7. Execution Commands  
8. Expected Metrics  
9. Risks  
10. Assumptions  

Plus summary table:

| File Created | File Updated | Reason | Impact |
|--------------|--------------|--------|--------|
| … | … | … | … |

---

## Important rules

- Never modify unrelated existing APIs.  
- Never break existing tests.  
- Reuse framework components whenever possible.  
- Show all files that will be created.  
- Explain every file update.  
- Follow existing architecture + **SDD** (localized diffs only).  
- Production-ready code only.  
- Do not commit real tokens/secrets.  
- Do not rewrite the whole framework for one API.

---

## Whenever I provide a new API

1. Add the API following current framework architecture.  
2. Identify all files requiring updates.  
3. Generate both **Functional** and **Performance** tests.  
4. Generate K6 / Locust / JMeter / Node script based on **what this repo already uses**.  
5. Generate realistic load profiles.  
6. Estimate suitable thresholds if not provided.  
7. Do not modify unrelated code.  
8. Provide the summary table (Created / Updated / Reason / Impact).  

---

## How to invoke (paste into chat)

```text
Follow docs/SDD.md and docs/MASTER_PROMPT_ADD_NEW_API.md.
Add the following API with Functional + Performance support.
Do not modify unrelated APIs or rewrite the framework.

<paste filled API_DETAILS_TEMPLATE.md content here>
```

---

## API details block

Use values from [`API_DETAILS_TEMPLATE.md`](./API_DETAILS_TEMPLATE.md):

```text
API Name: {{API_NAME}}
Method: {{METHOD}}
Base URL: {{BASE_URL}}
Endpoint: {{ENDPOINT}}
Headers: {{HEADERS}}
Query Params: {{QUERY_PARAMS}}
Path Params: {{PATH_PARAMS}}
Payload: {{PAYLOAD}}
Expected Status: {{EXPECTED_STATUS}}
Expected Response: {{EXPECTED_RESPONSE}}
SLA Requirement: {{SLA}}
Expected Peak Users: {{PEAK_USERS}}
Expected TPS: {{TPS}}
Notes: {{NOTES}}
```
