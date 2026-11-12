# Agent instructions

This repo uses **Spec-Driven Development**.

1. **Always read and follow** [`docs/SDD.md`](docs/SDD.md) before changing the performance framework.
2. Cursor rule: `.cursor/rules/sdd.mdc` (always apply).
3. Change only the **owning module** for the request (see SDD §3). Do not rewrite the whole framework.
4. Non-trivial changes → mini-spec under `docs/specs/` using the template in SDD §5.
5. Prefer env/API JSON config over code edits.
6. Keep shared reports in `performance/report-template.js`.
7. **New API:** fill [`docs/API_DETAILS_TEMPLATE.md`](docs/API_DETAILS_TEMPLATE.md) and follow [`docs/MASTER_PROMPT_ADD_NEW_API.md`](docs/MASTER_PROMPT_ADD_NEW_API.md) — generate **Functional + Performance** (not functional-only).
8. **CRM public suite:** [`docs/API_DETAILS_CRM_PLIPORTAL_PUBLIC.md`](docs/API_DETAILS_CRM_PLIPORTAL_PUBLIC.md) · `npm run test:crm:once|smoke|load`.

Related: `docs/SETUP.md`, `docs/EXECUTION.md`, `docs/TROUBLESHOOTING.md`.
