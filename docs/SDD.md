# Spec-Driven Development (SDD) — PLI IMS Performance Framework

**This file is the source of truth.**  
Any change to the performance framework **must** follow this SDD.  
Do **not** refactor or rewrite unrelated modules when fulfilling a request.

---

## 1. Goal

Keep the framework:

- **Stable** — one request does not destabilize the whole suite
- **Local** — change only the module that owns the behavior
- **Traceable** — every change maps to a short written spec (below)
- **Repeatable** — same patterns for agents, collection, reports, env

---

## 2. Non‑negotiable rules

1. **Read this SDD first** before editing `performance/` or related docs.
2. **Spec before code** for any new behavior (see §5 template). Paste the filled template into the chat or a short note under `docs/specs/` when the change is non-trivial.
3. **Touch only owning files** (see §3). No drive-by cleanups, renames, or “while we’re here” rewrites.
4. **Config over code** when possible (`*.env.json`, `apis*.json`, `package.json` scripts).
5. **Shared helpers stay shared** — put reusable report/HTTP logic in `report-template.js` / `helpers.js`; do not duplicate into every runner.
6. **Do not break report contract** — every run must still emit HTML + JSON via `writeFullTestReport` (or an approved equivalent).
7. **Preserve pass gates** unless the request explicitly changes them (`PASS_SUCCESS_RATE`, `PASS_P95_MS`, stop-on-fail).
8. **Staging vs prod isolation** — never weaken `ALLOW_PROD_RUN` or mix env files.
9. **After change**: syntax-check touched JS; run the **smallest** scenario that proves the change (`once` or `smoke` before full `load`).
10. **Update docs only for the same concern** (e.g. load ramp → `EXECUTION.md` / this SDD module map; not a full docs rewrite).

---

## 3. Module ownership map (change isolation)

| Concern | Own these files only | Do NOT touch unless requested |
|--------|----------------------|-------------------------------|
| Agent journey load/smoke/once | `performance/run-agents.js`, `performance/apis-agents.json` | `run-once-node.js`, `test.js`, collection `apis.json` |
| Agent API list / paths | `performance/apis-agents.json` | runners (unless path template shape changes) |
| All-GET once suite | `performance/run-once-node.js`, `performance/apis.json` | `run-agents.js` |
| **Add new API (func + perf)** | Follow `docs/MASTER_PROMPT_ADD_NEW_API.md` + fill `docs/API_DETAILS_TEMPLATE.md`; update only the suite inventory + owning runner + scripts/thresholds needed | Unrelated inventories, unrelated runners, backends |
| CRM PLI Portal public suite | `performance/apis-crm-pliportal.json`, `performance/run-crm-pliportal.js`, `CRM_*` keys in env JSON, `test:crm:*` scripts | `run-agents.js`, generic `apis.json`, other backends |
| k6 scenarios | `performance/test.js`, `performance/run.js`, `performance/helpers.js` | Node agent runner |
| Shared HTML/JSON report | `performance/report-template.js` | Copy-paste new report HTML into runners |
| Env / VU steps / thresholds | `performance/staging.env.json`, `prod.env.json`, `*.env.example.json` | Hardcode new constants in multiple runners |
| npm scripts | `package.json` `scripts` | Unrelated script names |
| Capacity / ops docs | matching file under `docs/` | Entire `docs/` tree |
| SDD / agent process | `docs/SDD.md`, `docs/specs/*`, `.cursor/rules/sdd.mdc` | Application backends |

### Allowed cross-module edits (exceptions)

- Adding a **new shared** report field → `report-template.js` **and** the **one** runner that needs it.
- Renaming an env key → env JSON + **only** the runners that read that key.
- New npm script → `package.json` only (+ one line in `docs/EXECUTION.md` if user-facing).

---

## 4. Workflow (every request)

```
1. Classify request → which module row in §3?
2. Write mini-spec (§5) if behavior/API/report/gate changes
3. Edit ONLY owning files
4. Keep public CLI/scripts stable (or document breaking change)
5. Verify with smallest command
6. Confirm report still generated
7. Stop — do not “improve” adjacent modules
```

### Examples

| User ask | Correct scope | Wrong scope |
|----------|---------------|-------------|
| “Update to 1000 users” | `STEP_VUS` in env + default in `run-agents.js` | Rewrite report template, once runner, k6 test |
| “Show API response in report” | `report-template.js` + response fields in calling runner | New parallel report system |
| “Fail reason in report” | Failure analysis in runner + section in `report-template.js` | Change thresholds / VU ramp |
| “Add one agent API” | `apis-agents.json` (+ journey wiring in `run-agents.js` if needed) | Regenerate all swagger inventory |

---

## 5. Mini-spec template (copy for each change)

Save non-trivial specs as `docs/specs/YYYY-MM-DD-short-name.md`.

```markdown
# Spec: <short name>
Date:
Request:

## Intent
What outcome the user wants (1–3 lines).

## In scope
- files:
- behavior:

## Out of scope
- (explicit: do not change …)

## Acceptance
- [ ] …
- [ ] Report still has HTML + JSON
- [ ] No unrelated file diffs

## Risks
- TLS/gateway, auth, data deps, etc.

## Verify
Command: `npm run …`
```

---

## 6. Architecture (current, keep this shape)

```
performance/
  staging.env.json / prod.env.json   # config knobs
  apis.json                          # collection GET inventory
  apis-agents.json                   # agent journey APIs
  run-agents.js                      # agent once/smoke/load (Node)
  run-once-node.js                   # all APIs once (Node)
  run.js + test.js + helpers.js      # k6 path
  report-template.js                 # shared formal report writer
  reports/<env>/                     # generated only — do not hand-edit as source
docs/
  SDD.md                             # THIS file — process truth
  specs/                             # per-change mini-specs
```

Reports **must** include (when applicable):

- Summary cards (status, calls, success %, latency, TLS/status0)
- Step table for load (with **Fail reason** column on FAIL)
- **Failure reasons** section on FAIL
- API hit / response samples (once = all; load = samples)
- JSON twin of the HTML report

---

## 7. Configuration knobs (prefer these)

In `staging.env.json` / examples:

| Key | Purpose |
|-----|---------|
| `BASE_URL` | Target host |
| `STEP_VUS` | Load ramp array |
| `STEP_DURATION_MS` | Per-step duration |
| `THINK_TIME_MS` | Pace between journeys |
| `PASS_SUCCESS_RATE` / `PASS_P95_MS` | Pass gates |
| `BODY_KEEP_CHARS` | Response size kept for report |
| `PRINT_HIT_LIMIT` / `PRINT_EVERY_RESPONSE` | Console response noise |

Changing behavior via these keys is preferred over editing loop logic.

---

## 8. Definition of Done (DoD)

A change is done only if:

- [ ] Matches a mini-spec or a clearly scoped one-line request
- [ ] Diff limited to §3 owning files (+ allowed exceptions)
- [ ] `node --check` passes on touched `.js` files
- [ ] Smallest relevant npm script succeeds or fails with a clear report
- [ ] FAIL paths still print **reason** in console and report
- [ ] No secrets committed; prod guard intact
- [ ] `docs/SDD.md` updated **only if** ownership map or contracts changed

---

## 9. Anti‑patterns (forbidden)

- “Quick” rewrite of the entire `performance/` folder for a small ask
- Duplicating HTML report markup inside each runner
- Silent removal of health-wait, think-time, or stop-on-fail
- Mixing agent journey with full collection inventory in one script without a new owned module
- Editing generated files under `reports/` as if they were source
- Expanding scope because “code looks messy”

---

## 10. Related docs

| Doc | Use when |
|-----|----------|
| `docs/SETUP.md` | Install / first run |
| `docs/EXECUTION.md` | How to run scenarios |
| `docs/TROUBLESHOOTING.md` | TLS / gateway / auth failures |
| `docs/CAPACITY_PLANNING.md` | VU / capacity interpretation |
| `docs/SECURITY.md` | Tokens / prod guards |
| `docs/API_DETAILS_TEMPLATE.md` | Fill every time before adding a new API |
| `docs/MASTER_PROMPT_ADD_NEW_API.md` | Master prompt: functional + performance for each new API |
| `docs/specs/` | Per-change SDD mini-specs |

### Add-new-API rule (mandatory)

When the user provides / asks to add a new API:

1. Require (or fill) `docs/API_DETAILS_TEMPLATE.md` fields.  
2. Execute `docs/MASTER_PROMPT_ADD_NEW_API.md` end-to-end.  
3. Generate **Functional + Performance** (smoke/baseline/load/stress/spike/soak as supported by this repo).  
4. Do **not** stop at functional-only coverage.  
5. Keep diffs localized per ownership map.

---

## 11. Cursor / agent enforcement

Project rule: `.cursor/rules/sdd.mdc` (`alwaysApply: true`).

Agents **must**:

1. Open and follow `docs/SDD.md`
2. Classify the request to a module row
3. Write a mini-spec for non-trivial work
4. Limit the diff
5. Refuse or push back on whole-framework rewrites unless the user explicitly asks for a redesign
