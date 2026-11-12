#!/usr/bin/env node
/**
 * Runs every API in apis.json once against BASE_URL.
 * Used when k6 gets TLS "unexpected EOF" from the gateway (common with some WAFs).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { writeFullTestReport } = require('./report-template');

const root = __dirname;
const envName = (process.argv[2] || 'staging').toLowerCase();
const envFile = path.join(root, `${envName}.env.json`);
const apis = JSON.parse(fs.readFileSync(path.join(root, 'apis.json'), 'utf8'));
const cfg = JSON.parse(fs.readFileSync(envFile, 'utf8'));
const baseUrl = String(cfg.BASE_URL || '').replace(/\/$/, '');
const reportsDir = path.join(root, 'reports', envName);
fs.mkdirSync(reportsDir, { recursive: true });

const BODY_KEEP_CHARS = Number(cfg.BODY_KEEP_CHARS || 8000);

function request(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const started = Date.now();
    const req = lib.get(
      url,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          ...(cfg.AUTH_TOKEN && cfg.AUTH_TOKEN !== 'REPLACE_WITH_STAGING_JWT'
            ? { Authorization: `Bearer ${cfg.AUTH_TOKEN}` }
            : {}),
        },
        timeout: Number(cfg.TIMEOUT_MS || 30000),
        rejectUnauthorized: false,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            json = null;
          }
          const kept = body.length > BODY_KEEP_CHARS ? `${body.slice(0, BODY_KEEP_CHARS)}\n...[truncated]` : body;
          resolve({
            status: res.statusCode || 0,
            durationMs: Date.now() - started,
            body: kept,
            response: kept,
            json,
            error: null,
          });
        });
      }
    );
    req.on('error', (err) => {
      resolve({
        status: 0,
        durationMs: Date.now() - started,
        body: '',
        response: '',
        json: null,
        error: err.message,
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 0,
        durationMs: Date.now() - started,
        body: '',
        response: '',
        json: null,
        error: 'timeout',
      });
    });
  });
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

(async () => {
  console.log(`\nRunning ALL APIs once on ${envName}`);
  console.log(`BASE_URL = ${baseUrl}`);
  console.log(`APIs     = ${apis.length}\n`);

  const results = [];
  for (let i = 0; i < apis.length; i++) {
    const api = apis[i];
    const url = `${baseUrl}${api.path}`;
    const res = await request(url);
    results.push({ ...api, url, ...res });
    const mark = res.status === 200 ? 'OK ' : 'FAIL';
    console.log(
      `\n[${String(i + 1).padStart(2, '0')}/${apis.length}] ${mark} ${res.status} ${res.durationMs}ms  ${api.service}`
    );
    console.log(`  PATH: ${api.path}`);
    if (res.error) console.log(`  error: ${res.error}`);
    const respText = res.json ? JSON.stringify(res.json, null, 2) : res.response || res.body || '';
    if (respText) {
      const lines = String(respText).split('\n');
      console.log(`  RESPONSE:\n${lines.slice(0, 40).join('\n')}${lines.length > 40 ? '\n  ... (truncated in console)' : ''}`);
    }
  }

  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const ok = results.filter((r) => r.status === 200).length;
  const failed = results.length - ok;
  const summary = {
    env: envName,
    baseUrl,
    total: results.length,
    ok,
    failed,
    successRate: Number(((ok / results.length) * 100).toFixed(2)),
    latencyMs: {
      avg: Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)),
      min: durations[0] || 0,
      med: percentile(durations, 50),
      p90: percentile(durations, 90),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      max: durations[durations.length - 1] || 0,
    },
    generatedAt: new Date().toISOString(),
    results,
  };

  const finalStatus = failed === 0 ? 'PASS' : 'FAIL';
  const failedApis = results.filter((r) => r.status !== 200);
  const failureReasons =
    finalStatus === 'PASS'
      ? []
      : [
          {
            code: 'API_FAIL',
            title: `${failedApis.length} API(s) failed`,
            detail: failedApis
              .slice(0, 20)
              .map(
                (r) =>
                  `${r.path} → status=${r.status}${r.error ? ` error=${r.error}` : ''}`
              )
              .join(' | '),
          },
          ...(failedApis.some((r) => r.status === 0)
            ? [
                {
                  code: 'ROOT_CAUSE',
                  title: 'Likely root cause',
                  detail:
                    'One or more calls returned status 0 (TLS/network). Gateway may be blocking or unreachable.',
                },
              ]
            : []),
        ];
  if (failureReasons.length) {
    console.log('\nFailure reasons:');
    for (const f of failureReasons) console.log(`  - [${f.code}] ${f.title}: ${f.detail}`);
  }

  writeFullTestReport({
    reportsDir,
    filePrefix: 'collection-once',
    title: 'All APIs Once – Test Report',
    envName,
    scenario: 'once',
    baseUrl,
    keepRuns: Number(cfg.KEEP_REPORT_RUNS || 2),
    summary: {
      ...summary,
      finalStatus,
      avgMs: summary.latencyMs.avg,
      p95Ms: summary.latencyMs.p95,
      status0: results.filter((r) => r.status === 0).length,
      failureReasons,
    },
    steps: [],
    failureReasons,
    apis: results.map((r) => ({
      service: r.service,
      name: r.name || r.service,
      path: r.path,
      status: r.status,
      durationMs: r.durationMs,
      ok: r.status === 200,
      error: r.error,
      body: r.body,
      response: r.response || r.body,
      json: r.json,
      failReason:
        r.status === 200
          ? null
          : r.error || (r.status === 0 ? 'status 0 – TLS/network' : `HTTP ${r.status}`),
    })),
    objective: [
      'Execute every curated GET API once against the target environment.',
      'Capture per-API status, latency, and overall success for a baseline connectivity check.',
    ],
    scope: [
      `API inventory size: <strong>${apis.length}</strong>`,
      'Source: <code>performance/apis.json</code>',
    ],
    loadModel: [
      'Pattern: sequential once-through (1 request per API)',
      `Timeout: <strong>${cfg.TIMEOUT_MS || 30000}ms</strong>`,
      'No concurrency / no ramp',
    ],
    observations: [
      `OK=<strong>${ok}</strong> FAIL=<strong>${failed}</strong> Success=<strong>${summary.successRate}%</strong>`,
      `Latency avg=<strong>${summary.latencyMs.avg}ms</strong> P95=<strong>${summary.latencyMs.p95}ms</strong>`,
    ],
    recommendations:
      finalStatus === 'PASS'
        ? ['Baseline once-run is clean — proceed to smoke/load scenarios.']
        : [
            'Investigate failed APIs (auth, path, gateway TLS) before load testing.',
            'Re-run after fixing failing endpoints.',
          ],
    open: true,
  });

  console.log(`\nSummary: OK=${ok} FAIL=${failed} Success=${summary.successRate}%`);
})();
