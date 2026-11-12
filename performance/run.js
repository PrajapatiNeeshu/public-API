#!/usr/bin/env node
/**
 * Simple runner:
 *   node performance/run.js staging smoke
 *   node performance/run.js prod load
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const envName = (process.argv[2] || 'staging').toLowerCase();
const scenario = (process.argv[3] || 'smoke').toLowerCase();

if (!['staging', 'prod'].includes(envName)) {
  console.error('Usage: node performance/run.js <staging|prod> <smoke|baseline|load|stress|spike|soak>');
  process.exit(1);
}

const envFile = path.join(__dirname, `${envName}.env.json`);
if (!fs.existsSync(envFile)) {
  console.error(`Missing ${envFile}`);
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(envFile, 'utf8'));
if (envName === 'prod' && String(cfg.ALLOW_PROD_RUN || 'false').toLowerCase() !== 'true') {
  console.error('Prod blocked. Set ALLOW_PROD_RUN=true in performance/prod.env.json');
  process.exit(2);
}

const reportsDir = path.join(__dirname, 'reports', envName);
fs.mkdirSync(reportsDir, { recursive: true });

const selectedScenario = scenario || cfg.SCENARIO || 'smoke';
const apiCount = JSON.parse(fs.readFileSync(path.join(__dirname, 'apis.json'), 'utf8')).length;
const args = [
  'run',
  '-e', `ENV_NAME=${envName}`,
  '-e', `SCENARIO=${selectedScenario}`,
  '-e', `BASE_URL=${cfg.BASE_URL || ''}`,
  '-e', `BASE_URL_POLICY_ISSUE=${cfg.BASE_URL_POLICY_ISSUE || ''}`,
  '-e', `AUTH_MODE=${cfg.AUTH_MODE || 'bearer'}`,
  '-e', `AUTH_TOKEN=${cfg.AUTH_TOKEN || ''}`,
  '-e', `TIMEOUT_MS=${cfg.TIMEOUT_MS || '30000'}`,
  '-e', `API_COUNT=${apiCount}`,
  '-e', `K6_REPORTS_DIR=${reportsDir}`,
  path.join(__dirname, 'test.js'),
];

console.log(`\nRunning ${selectedScenario} on ${envName}`);
console.log(`BASE_URL = ${cfg.BASE_URL}`);
if (cfg.BASE_URL_POLICY_ISSUE) {
  console.log(`POLICY_ISSUE_URL = ${cfg.BASE_URL_POLICY_ISSUE}`);
}
console.log(`Reports  = performance/reports/${envName}\n`);

const result = spawnSync('k6', args, { cwd: root, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
