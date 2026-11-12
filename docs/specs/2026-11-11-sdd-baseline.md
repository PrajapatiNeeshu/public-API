# Spec: Introduce Spec-Driven Development baseline
Date: 2026-11-11
Request: Create SDD so framework updates stay localized and always follow an SDD markdown file.

## Intent
Establish a mandatory change process and ownership map so agents/humans do not rewrite the whole performance framework for small requests.

## In scope
- files: `docs/SDD.md`, `docs/specs/*`, `.cursor/rules/sdd.mdc`, `AGENTS.md`
- behavior: always-apply Cursor rule pointing at SDD; module ownership; mini-spec template

## Out of scope
- runners (`run-agents.js`, etc.)
- report template behavior
- env VU configuration
- backend services

## Acceptance
- [x] `docs/SDD.md` exists with ownership map + DoD
- [x] `.cursor/rules/sdd.mdc` alwaysApply true
- [x] `docs/specs/` ready for future change specs
- [x] No unrelated performance runner diffs

## Risks
- Agents ignore rules if SDD not referenced — mitigated by alwaysApply rule + AGENTS.md

## Verify
Open `docs/SDD.md` and confirm `.cursor/rules/sdd.mdc` is present.
