# Security Considerations

## Credential masking

- `performance/utils/env-loader.js` masks tokens in console summaries
- Secrets files are gitignored (`staging.env.json`, `prod.env.json`)
- Example templates contain no real credentials

## Secret management

| Environment | Recommended store |
|-------------|-------------------|
| Local | gitignored `*.env.json` |
| GitHub Actions | repository/environment secrets |
| Azure DevOps | variable groups / Key Vault |
| Jenkins | Credentials Binding |

## Environment isolation

- Separate staging/prod env files
- Separate report filenames include env + scenario
- Prod hard-stop unless `ALLOW_PROD_RUN=true`
- Do not reuse staging tokens against production gateways

## Safe testing practices

- Prefer read-only GET suites
- Avoid soak/stress on production during peak business hours
- Rotate tokens after large test campaigns
- Redact report artifacts before external sharing
