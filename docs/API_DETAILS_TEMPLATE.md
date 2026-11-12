# API Details Template (Use Every Time)

Copy this template **every time** a new API is added.  
Fill all fields before asking Cursor/agent to integrate the API.  
Empty fields → agent must estimate safely and list assumptions (never invent production secrets).

Related:

- Master process: [`MASTER_PROMPT_ADD_NEW_API.md`](./MASTER_PROMPT_ADD_NEW_API.md)
- Change isolation: [`SDD.md`](./SDD.md)

---

## Template (copy from here)

```markdown
API Name:
{{API_NAME}}

Method:
{{METHOD}}

Base URL:
{{BASE_URL}}

Endpoint:
{{ENDPOINT}}

Headers:
{{HEADERS}}

Query Params:
{{QUERY_PARAMS}}

Path Params:
{{PATH_PARAMS}}

Payload:
{{PAYLOAD}}

Expected Status:
{{EXPECTED_STATUS}}

Expected Response:
{{EXPECTED_RESPONSE}}

Expected Response Keys:
{{EXPECTED_RESPONSE_KEYS}}

Auth Required:
{{AUTH_REQUIRED}}   # none | bearer | api-key | custom

Dependencies:
{{DEPENDENCIES}}    # prior APIs / data setup needed

Rate Limits:
{{RATE_LIMITS}}

Business Criticality:
{{CRITICALITY}}     # low | medium | high | critical

SLA Requirement:
{{SLA}}             # e.g. P95 < 500ms

Expected Peak Users:
{{PEAK_USERS}}

Expected TPS:
{{TPS}}

Environment:
{{ENV}}             # staging | prod

Suite Mapping:
{{SUITE}}           # agents | collection | new-module-name

Notes:
{{NOTES}}
```

---

## Example (filled)

```markdown
API Name: Get Users

Method: GET

Base URL:
https://api.company.com

Endpoint:
/users

Headers:
Authorization: Bearer token
Accept: application/json

Query Params:
(none)

Path Params:
(none)

Payload:
(none – GET)

Expected Status:
200

Expected Response:
JSON object/array with user records

Expected Response Keys:
id
name
email

Auth Required:
bearer

Dependencies:
Valid auth token

Rate Limits:
Unknown – observe gateway TLS/WAF limits

Business Criticality:
high

SLA Requirement:
P95 < 500ms

Expected Peak Users:
500

Expected TPS:
100

Environment:
staging

Suite Mapping:
collection

Notes:
Read-only GET; include smoke + baseline + load profiles.
```

---

## PLI IMS / this repo – quick fill hints

| Field | Where it usually maps |
|-------|------------------------|
| Base URL | `performance/staging.env.json` → `BASE_URL` |
| Endpoint | `performance/apis.json` or `performance/apis-agents.json` |
| Agents journey APIs | `apis-agents.json` + `run-agents.js` |
| Collection GETs | `apis.json` + `run-once-node.js` / k6 `test.js` |
| Auth | `AUTH_TOKEN` in env JSON (never commit real JWT) |
| Peak users / ramp | `STEP_VUS` in env JSON |
| SLA / gates | `PASS_P95_MS`, `PASS_SUCCESS_RATE` |
| Reports | Always via `performance/report-template.js` |

---

## Checklist before handing to Cursor

- [ ] Method + Endpoint filled
- [ ] Expected status filled
- [ ] Expected response keys or sample filled
- [ ] Env (`staging` / `prod`) filled
- [ ] Suite mapping filled (`agents` / `collection` / new)
- [ ] Peak users or SLA filled (or marked “estimate”)
- [ ] No real secrets pasted into git-tracked files
