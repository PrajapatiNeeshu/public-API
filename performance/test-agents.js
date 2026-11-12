/**
 * K6 version of agent flow (may hit TLS EOF on some gateways).
 * Prefer: npm run test:agents:once | test:agents:smoke
 *
 * Flow:
 *  1) search?name=ajay
 *  2) use returned agent_code values
 *  3) search?agent_code={code}
 *  4) keycloak-identity/{code}
 */
import { check, sleep } from 'k6';
import http from 'k6/http';
import { makeReport, scenarioOptions, headers } from './helpers.js';

const scenario = (__ENV.SCENARIO || 'smoke').toLowerCase();
const base = (__ENV.BASE_URL || 'https://imssit.indiapost.gov.in').replace(/\/$/, '');
const cfg = JSON.parse(open('./apis-agents.json'));

export const options = {
  ...scenarioOptions(scenario === 'once' ? 'smoke' : scenario),
  setupTimeout: '60s',
};

export const handleSummary = makeReport(`agents-${__ENV.ENV_NAME || 'staging'}-${scenario}`);

export function setup() {
  const res = http.get(`${base}${cfg.searchByName.path}`, { headers: headers(), timeout: '30s' });
  check(res, { 'search name status 200': (r) => r.status === 200 });
  let codes = [];
  try {
    const body = res.json();
    codes = (body.results || []).map((r) => r.agent_code).filter(Boolean);
  } catch (e) {
    codes = [];
  }
  if (!codes.length) codes = cfg.fallbackAgentCodes || ['DA00830328'];
  return { codes };
}

export default function (data) {
  const codes = data.codes || cfg.fallbackAgentCodes;
  const code = codes[Math.floor(Math.random() * codes.length)];

  const searchByCode = http.get(
    `${base}/bepliagent/v1/agents/search?agent_code=${encodeURIComponent(code)}`,
    { headers: headers(), tags: { api: 'search-by-code' }, timeout: '30s' }
  );
  check(searchByCode, { 'search by agent_code 200': (r) => r.status === 200 });

  const keycloak = http.get(
    `${base}/bepliagent/v1/agents/keycloak-identity/${encodeURIComponent(code)}`,
    { headers: headers(), tags: { api: 'keycloak-identity' }, timeout: '30s' }
  );
  check(keycloak, { 'keycloak identity 200': (r) => r.status === 200 });

  sleep(0.2);
}
