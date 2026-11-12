# Capacity Planning Report — PLI/IMS GET APIs

## Planning assumptions

| Assumption | Value |
|------------|-------|
| Target SLA P50 | < 200 ms |
| Target SLA P95 | < 500 ms |
| Target SLA P99 | < 1000 ms |
| Error rate | < 1% |
| Availability | 99.9% |
| Expected concurrent users | 500 |
| Expected peak users | 2000 |
| Think time (interactive) | 1–3 s |
| Avg calls / user journey | 8–15 GET calls |
| Useful concurrency model | open/closed mix; K6 closed for baseline |

Derived request demand (approx):

- At 500 concurrent users with 2s think time and 1 in-flight call average ≈ **250 RPS**
- At 2000 peak with same model ≈ **1000 RPS**
- With multi-call journeys (10 GETs, 2s pacing) sustained backend demand can reach **1–2.5k RPS** across services

## Recommended load profile

| Stage | Users | Goal |
|-------|------:|------|
| Smoke | 1 | Contract validation |
| Baseline | 10 | Latency fingerprint |
| Load | 100 | Expected daily concurrent band |
| Pre-prod peak | 500 | Expected concurrent SLA proof |
| Peak rehearsal | 1000–2000 | Festival/peak readiness |
| Stress | ramp to break | Find cliff |
| Soak | 50 for 12h | Memory/connection leaks |

## Capacity scenarios

### 100 users

- Expected RPS: ~50–150
- Risk: Low
- Expectation: All services should meet P95 < 500ms if staging mirrors prod topology
- Action: Use as CI gate after each release train

### 500 users (expected concurrent)

- Expected RPS: ~250–750
- Risk: Medium on CRM + Agent + Policy Services (largest GET surface)
- Expectation: P95 may approach 500ms on heavier list endpoints
- Action: Horizontal scale gateway + DB read replicas; cache product master / reference GETs

### 1000 users

- Expected RPS: ~500–1500
- Risk: High for `crm-pliportal-backend`, `pliagent-backend`, `ims_policyservices_backend`
- Expectation: P99 may exceed 1000ms without caching/pagination controls
- Action: Enforce pagination defaults, add CDN/edge cache for static masters, tune pool sizes

### 2000 users (expected peak)

- Expected RPS: ~1000–3000
- Risk: Very High without autoscaling
- Expectation: Error rate may breach 1% first on claims/collections authorize-linked reads under lock contention
- Action: Peak-event runbook, pre-warm pools, rate-limit non-critical GETs, isolate noisy neighbors

### Breaking point (prediction)

Based on API surface area and typical Go/Java microservice ceilings without measured staging baselines:

| Signal | Predicted region |
|--------|------------------|
| First SLA breach (P95 > 500ms) | **600–900 concurrent users** |
| Error rate > 1% | **1200–1600 concurrent users** |
| Systemic saturation / cascading timeouts | **1800–2200+ concurrent users** |

Validate with `npm run test:stress:staging` and replace predictions with measured cliffs.

## Performance risks

1. **Large GET surface (1041)** — noisy neighbor effect across shared DB/gateway
2. **No OpenAPI security metadata** — misconfigured auth can skew results with 401 storms
3. **Path-param heavy APIs (538)** — incomplete test data under-represents real hot paths
4. **Shared `/api` prefix** for policy mgmt + policy services — routing ambiguity / gateway contention
5. **Long soak (12h)** — connection pool leaks, GC pressure, certificate/token expiry mid-run
6. **Prod testing** — business-hour impact; hard-gated by `ALLOW_PROD_RUN`

## Bottleneck predictions

| Layer | Likely bottleneck | Why |
|-------|-------------------|-----|
| API Gateway | Connection/queue saturation at peak | Fan-in from all microservices |
| CRM Portal | High cardinality list GETs | 252 endpoints, many listing routes |
| Agent Backend | Session/profile reads | 193 endpoints, session path params |
| Policy Services | Loan/eligibility GETs | Complex joins / workflow status |
| Product Master | Cache miss storms | Reference data hit by many journeys |
| DB | Read locks / slow queries | Claims + collections authorize flows |

## Capacity estimation (infra guidance)

Assuming ~1.5 RPS/user effective and P95 headroom target 40%:

| Concurrent users | Approx RPS target | Suggested app instances (per hot service) | Notes |
|------------------|-------------------|--------------------------------------------|-------|
| 100 | 150 | 2–3 | Minimal HA |
| 500 | 750 | 4–6 | Expected steady state |
| 1000 | 1500 | 8–12 | Add read replicas |
| 2000 | 3000 | 16–24 + autoscaling | Peak event mode |
| Breaking point | measure | Scale out until P95/error cliff | Use stress profile |

## Pass/fail gates for capacity sign-off

- 500-user load: P95 < 500ms, errors < 1%, availability >= 99.9%
- 2000-user peak rehearsal: P95 < 1000ms (relaxed), errors < 2% for spike window only, recovery to SLA within 5 minutes after ramp-down
