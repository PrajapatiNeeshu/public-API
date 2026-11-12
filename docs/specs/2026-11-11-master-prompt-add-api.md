# Spec: Master prompt + API details template for new APIs
Date: 2026-11-11
Request: Create docs for adding new APIs with functional + performance support; keep SDD localization.

## Intent
Whenever a new API is provided, agents must generate functional validation and performance profiles using a standard template and master prompt — without rewriting the whole framework.

## In scope
- files: `docs/API_DETAILS_TEMPLATE.md`, `docs/MASTER_PROMPT_ADD_NEW_API.md`, `docs/SDD.md` (links + ownership row), `.cursor/rules/sdd.mdc`, `AGENTS.md`
- behavior: mandatory func+perf path for new APIs; template-every-time

## Out of scope
- Implementing a specific new API now
- Changing runners / report-template behavior
- Adding Locust/JMeter/Python stacks

## Acceptance
- [x] Template MD in docs
- [x] Master prompt MD in docs
- [x] SDD + always-apply rule reference both
- [x] No performance runner code changes

## Verify
Open `docs/API_DETAILS_TEMPLATE.md` and `docs/MASTER_PROMPT_ADD_NEW_API.md`.
