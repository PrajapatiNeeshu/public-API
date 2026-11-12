# Spec: Client-ready report hardening (PII + coverage + RCA)
Date: 2026-11-12
Request: Review feedback — current CRM PDF not client-ready; improve report for confidentiality, coverage honesty, termination RCA.

## Intent
Make HTML/PDF reports safe and honest for stakeholders: redact PII, show configured vs executed APIs, planned vs achieved VUs, root-cause, staging disclaimer. Keep FAIL verdict when gates fail.

## In scope
- `performance/report-template.js` (redaction, client sections)
- `performance/run-crm-pliportal.js` / `run-agents.js` (pass audience + coverage metadata)
- `staging.env.json` `REPORT_AUDIENCE`
- Regenerate sanitised client report from last CRM run

## Out of scope
- Changing PASS/FAIL thresholds unless requested
- Enabling POST payloads
- Claiming production capacity

## Acceptance
- [ ] Client report has no raw name/email/address/DOB in response samples
- [ ] Report shows planned vs achieved VUs and stop reason
- [ ] Unique executed endpoints listed vs configured count
- [ ] Staging disclaimer present
