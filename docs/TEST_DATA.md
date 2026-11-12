# Test Data Guide

## API inventory sources

Swagger/OpenAPI inputs:

`C:\Users\nekumar\Downloads\release\release\<service>\{staging|prod}\resolved_swagger.json`

## Curated suite

Executable smoke/load endpoints are **static GET paths** (no `{path}` params), top 5 per service:

`performance/data/inventory/curated-get-suite.json`

Full catalog (1041 GETs/env):

`performance/data/inventory/api-inventory.json`

## Path-parameterized APIs

538 staging GETs require path params (IDs, policy numbers, session IDs).  
To include them:

1. Add values under `performance/data/testdata/<env>/path-params.json`
2. Extend `performance/utils/request.js` / scenario script to substitute placeholders
3. Prefer non-PII synthetic IDs in staging; masked tokens in prod

## Query parameters

Optional query params discovered in swagger are retained in inventory.  
Default runs omit optional query params for maximum compatibility.

## Auth test data

Never store real production tokens in git. Prefer:

- CI secret stores (GitHub Actions / Azure DevOps / Jenkins credentials)
- Short-lived staging JWTs
- Environment variable injection via runner
