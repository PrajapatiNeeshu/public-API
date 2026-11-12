#!/usr/bin/env node
/**
 * CRM PLI Portal – all GET APIs (public + private) functional + performance.
 * Private GETs send Bearer AUTH_TOKEN; POSTs stay deferred.
 *
 *   node performance/run-crm-pliportal.js staging once
 *   node performance/run-crm-pliportal.js staging smoke
 *   node performance/run-crm-pliportal.js staging load
 *
 * Inventory: performance/apis-crm-pliportal.json
 * Reports:   performance/report-template.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { writeFullTestReport } = require('./report-template');

const root = __dirname;
const envName = (process.argv[2] || 'staging').toLowerCase();
const scenario = (process.argv[3] || 'once').toLowerCase();
const cfg = JSON.parse(fs.readFileSync(path.join(root, `${envName}.env.json`), 'utf8'));
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'apis-crm-pliportal.json'), 'utf8'));
const baseUrl = String(cfg.BASE_URL || 'https://imssit.indiapost.gov.in').replace(/\/$/, '');
const reportsDir = path.join(root, 'reports', envName);
fs.mkdirSync(reportsDir, { recursive: true });

const BODY_KEEP_CHARS = Number(cfg.BODY_KEEP_CHARS || 8000);
const STEP_DURATION_MS = Number(cfg.STEP_DURATION_MS || 30000);
const THINK_TIME_MS = Number(cfg.THINK_TIME_MS || 1000);
// CRM-specific gates (do not reuse agents' 500ms P95 — profile GETs are ~2–3s)
const PASS_SUCCESS_RATE = Number(cfg.CRM_PASS_SUCCESS_RATE ?? cfg.PASS_SUCCESS_RATE ?? 75);
const PASS_P95_MS = Number(cfg.CRM_PASS_P95_MS ?? 200);
const PASS_MODE = String(cfg.CRM_PASS_MODE || 'strict_200'); // no_5xx | status_2xx | strict_200
const METHOD_FILTER = Array.isArray(cfg.CRM_METHODS) && cfg.CRM_METHODS.length
  ? cfg.CRM_METHODS.map((m) => String(m).toUpperCase())
  : ['GET']; // default GET-only while POSTs are deferred
const STEP_VUS = Array.isArray(cfg.CRM_STEP_VUS) && cfg.CRM_STEP_VUS.length
  ? cfg.CRM_STEP_VUS.map(Number)
  : Array.isArray(cfg.STEP_VUS) && cfg.STEP_VUS.length
    ? cfg.STEP_VUS.map(Number)
    : [1, 5, 10, 25, 50, 100,150,200,300,400,500,600,700,800,900,1000];

const testData = {
  mobile_number: '0000000000',
  customer_id: '00000000',
  pincode: '000000',
  'office-id': '0',
  'office-type': 'HO',
  ...(cfg.CRM_TEST_DATA || {}),
};

const customers = Array.isArray(cfg.CRM_TEST_CUSTOMERS) && cfg.CRM_TEST_CUSTOMERS.length
  ? cfg.CRM_TEST_CUSTOMERS
  : [{ customer_id: testData.customer_id, mobile_number: testData.mobile_number }];

// Only enabled APIs matching method filter (POSTs commented/disabled in inventory)
const apis = (inventory.apis || []).filter((a) => {
  if (a.enabled === false) return false;
  if (METHOD_FILTER.length && !METHOD_FILTER.includes(String(a.method || 'GET').toUpperCase())) {
    return false;
  }
  return true;
});

let customerCursor = 0;
function nextCustomerContext() {
  const c = customers[customerCursor % customers.length];
  customerCursor += 1;
  return {
    ...testData,
    customer_id: String(c.customer_id),
    mobile_number: String(c.mobile_number),
  };
}

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: Math.max(50, Math.max(...STEP_VUS, 10)),
  maxFreeSockets: 20,
  timeout: Number(cfg.TIMEOUT_MS || 30000),
  rejectUnauthorized: false,
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function isOk(status) {
  if (PASS_MODE === 'strict_200') return status === 200;
  if (PASS_MODE === 'status_2xx') return status >= 200 && status < 300;
  // no_5xx: any real HTTP response below 500 counts (public OTP POSTs often 4xx without payload)
  return status > 0 && status < 500;
}

function buildUrl(api, data) {
  const ctx = data || testData;
  let p = api.path;
  for (const name of api.pathParams || []) {
    const val = encodeURIComponent(String(ctx[name] ?? ctx[name.replace(/-/g, '_')] ?? '1'));
    p = p.replace(`{${name}}`, val);
  }
  const q = new URLSearchParams();
  for (const name of api.queryRequired || []) {
    const val = ctx[name] ?? ctx[name.replace(/-/g, '_')] ?? '1';
    q.set(name, String(val));
  }
  const qs = q.toString();
  return `${baseUrl}${p}${qs ? `?${qs}` : ''}`;
}

function needsCustomerRotation(api) {
  const params = [...(api.pathParams || []), ...(api.queryRequired || [])];
  return params.includes('customer_id') || params.includes('mobile_number');
}

function request(api, data) {
  return new Promise((resolve) => {
    const ctx = data || testData;
    const url = buildUrl(api, ctx);
    const lib = url.startsWith('https') ? https : http;
    const started = Date.now();
    const headers = {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Connection: 'keep-alive',
    };
    const token = String(cfg.AUTH_TOKEN || '').trim();
    const tokenOk = token && token !== 'REPLACE_WITH_STAGING_JWT';
    // Private GETs and any xTokenRequired API get Bearer; optional CRM_AUTH_ALL_GETS=true for public too
    const needAuth =
      api.xTokenRequired === true ||
      api.xPublic === false ||
      String(cfg.CRM_AUTH_ALL_GETS || '').toLowerCase() === 'true';
    if (needAuth && tokenOk) {
      headers.Authorization = `Bearer ${token}`;
    }
    const method = (api.method || 'GET').toUpperCase();
    let bodyStr = null;
    if (method !== 'GET' && method !== 'HEAD') {
      const payload = api.defaultBody && Object.keys(api.defaultBody).length ? api.defaultBody : {};
      bodyStr = JSON.stringify(payload);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const u = new URL(url);
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers,
        timeout: Number(cfg.TIMEOUT_MS || 30000),
        agent: u.protocol === 'https:' ? agent : undefined,
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
          const kept =
            body.length > BODY_KEEP_CHARS ? `${body.slice(0, BODY_KEEP_CHARS)}\n...[truncated]` : body;
          const status = res.statusCode || 0;
          resolve({
            status,
            durationMs: Date.now() - started,
            ok: isOk(status),
            body: kept,
            response: kept,
            json,
            error: null,
            url,
          });
        });
      }
    );
    req.on('error', (err) =>
      resolve({
        status: 0,
        durationMs: Date.now() - started,
        ok: false,
        body: '',
        response: '',
        json: null,
        error: err.message,
        url,
      })
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 0,
        durationMs: Date.now() - started,
        ok: false,
        body: '',
        response: '',
        json: null,
        error: 'timeout',
        url,
      });
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function toReportRow(api, res, ctx) {
  return {
    service: api.service,
    name: api.name,
    path: api.path,
    method: api.method,
    customer_id: ctx?.customer_id || null,
    mobile_number: ctx?.mobile_number || null,
    status: res.status,
    durationMs: res.durationMs,
    ok: res.ok,
    error: res.error,
    body: res.body,
    response: res.response,
    json: res.json,
    failReason: res.ok
      ? null
      : res.error || (res.status === 0 ? 'status 0 – TLS/network' : `HTTP ${res.status}`),
  };
}

function logHit(api, res, ctx) {
  const mark = res.ok ? 'OK ' : 'FAIL';
  console.log(`\n[${mark}] ${res.status} ${res.durationMs}ms  ${api.method} ${api.name}`);
  console.log(`  PATH: ${api.path}`);
  if (ctx?.customer_id) console.log(`  customer_id: ${ctx.customer_id}`);
  if (ctx?.mobile_number) console.log(`  mobile_number: ${ctx.mobile_number}`);
  if (res.error) console.log(`  error: ${res.error}`);
  const text = res.json ? JSON.stringify(res.json, null, 2) : res.response || '';
  if (text) {
    const lines = String(text).split('\n');
    console.log(
      `  RESPONSE:\n${lines.slice(0, 25).join('\n')}${lines.length > 25 ? '\n  ... (truncated in console)' : ''}`
    );
  }
}

async function hitOne(api, results, { print = true, data = null } = {}) {
  const rate = Number(api.xRateLimit || 0);
  if (rate > 0 && rate <= 5) await sleep(200);
  const ctx = data || (needsCustomerRotation(api) ? nextCustomerContext() : { ...testData });
  const res = await request(api, ctx);
  const row = toReportRow(api, res, ctx);
  if (print) logHit(api, res, ctx);
  results.push(row);
  return row;
}

function summarize(results) {
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const ok = results.filter((r) => r.ok).length;
  const total = results.length;
  const successRate = total ? Number(((ok / total) * 100).toFixed(2)) : 0;
  return {
    total,
    ok,
    failed: total - ok,
    successRate,
    avgMs: total ? Number((durations.reduce((a, b) => a + b, 0) / total).toFixed(2)) : 0,
    p50Ms: percentile(durations, 50),
    p90Ms: percentile(durations, 90),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    status0: results.filter((r) => r.status === 0).length,
  };
}

function buildFailureReasons(summary, steps, results) {
  if (summary.finalStatus === 'PASS') return [];
  const reasons = [];
  for (const s of (steps || []).filter((x) => x.passed === false)) {
    reasons.push({
      code: 'STEP_FAIL',
      title: `Step failed at VUs=${s.vus}`,
      detail: `success ${s.successRate}% (need ≥${PASS_SUCCESS_RATE}%), p95=${s.p95Ms}ms (need ≤${PASS_P95_MS}), tls0=${s.status0}`,
    });
  }
  const fails = (results || []).filter((r) => !r.ok);
  const counts = {};
  for (const r of fails) {
    const k = r.failReason || `HTTP ${r.status}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, n]) => `${k} → ${n}`)
    .join(' | ');
  if (top) {
    reasons.push({ code: 'ERROR_BREAKDOWN', title: 'Top failure reasons', detail: top });
  }
  return reasons;
}

function writeReport(summary, steps, results) {
  const failureReasons = buildFailureReasons(summary, steps, results);
  if (failureReasons.length) {
    console.log('\nFailure reasons:');
    for (const f of failureReasons) console.log(`  - [${f.code}] ${f.title}: ${f.detail}`);
  }
  return writeFullTestReport({
    reportsDir,
    filePrefix: `crm-pliportal-${scenario}`,
    title: `CRM PLI Portal Public APIs – ${scenario} Test Report`,
    envName,
    scenario,
    baseUrl,
    summary: { ...summary, failureReasons },
    steps,
    apis: results.slice(0, scenario === 'once' ? 500 : 300),
    failureReasons,
    preparedBy: cfg.REPORT_PREPARED_BY || 'Neeshu Kumar',
    reportAudience: cfg.REPORT_AUDIENCE || 'client',
    coverage: {
      configuredApis: (inventory.apis || []).length,
      enabledApis: apis.length,
      plannedVus: STEP_VUS,
      methods: METHOD_FILTER,
      postDeferred: true,
    },
    keepRuns: Number(cfg.KEEP_REPORT_RUNS || 2),
    objective: [
      'Functional + performance coverage for crm-pliportal-backend <strong>all GET</strong> APIs (public + private) on staging.',
      'Private GETs use Bearer <code>AUTH_TOKEN</code>; client reports redact PII.',
      `PASS_MODE=<code>${PASS_MODE}</code> · load gate: success≥${PASS_SUCCESS_RATE}% AND P95≤${PASS_P95_MS}ms.`,
    ],
    scope: [
      `Inventory: <code>performance/apis-crm-pliportal.json</code> (configured ${(inventory.apis || []).length}; enabled filter ${apis.length} ${METHOD_FILTER.join('/')}; private/auth ${apis.filter((a) => a.xPublic === false || a.xTokenRequired).length})`,
      `Methods: <code>${METHOD_FILTER.join(', ')}</code> — POST deferred until valid non-production payloads are provided`,
      'Test customers / path params: from CRM_TEST_DATA (redacted in client reports)',
      `Pincode/office defaults: ${testData.pincode} / ${testData['office-id']}`,
      'Environment: staging (non-production) — do not represent as production performance',
    ],
    loadModel:
      scenario === 'load'
        ? [
            `Planned step VUs: <strong>${STEP_VUS.join(' → ')}</strong> (stops on first failed gate)`,
            `Step duration: ${STEP_DURATION_MS / 1000}s · think ${THINK_TIME_MS}ms`,
            `Pass gate: success≥${PASS_SUCCESS_RATE}% AND P95≤${PASS_P95_MS}ms (confirm if this is agreed SLA vs internal threshold)`,
          ]
        : scenario === 'smoke'
          ? ['1 VU · 60s cycling all public CRM APIs', `think ${THINK_TIME_MS}ms`]
          : ['Sequential once-through of all public CRM APIs'],
    observations: [
      `Overall success=<strong>${summary.successRate}%</strong> total=<strong>${summary.total}</strong> · maxPassedVus=<strong>${summary.maxPassedVus ?? 0}</strong>`,
      ...failureReasons.map((f) => `<strong>${f.title}:</strong> ${f.detail}`),
    ],
    recommendations:
      summary.finalStatus === 'PASS'
        ? [
            'Suite passed under current gate — keep client PII redaction on.',
            'Publish peak RPS/TPS from this run and plan sustained-load follow-up.',
          ]
        : [
            'Keep FAIL verdict; do not present this preliminary run as full application failure.',
            'Align P95 SLO by API class (office GETs vs customer profile/send-id) before client sign-off.',
            'Complete planned VU ramp only after threshold alignment; then capture peak RPS/TPS.',
            'Enable POST APIs only with valid non-production payloads; keep REPORT_AUDIENCE=client.',
          ],
    open: true,
  });
}

async function runStep(vus, durationMs) {
  const results = [];
  const stopAt = Date.now() + durationMs;
  let idx = 0;
  const workers = Array.from({ length: vus }, (_, id) =>
    (async () => {
      await sleep(id * 40);
      while (Date.now() < stopAt) {
        const api = apis[idx % apis.length];
        idx += 1;
        await hitOne(api, results, { print: results.length < 20 });
        if (Date.now() >= stopAt) break;
        await sleep(THINK_TIME_MS);
      }
    })()
  );
  await Promise.all(workers);
  const stats = summarize(results);
  const passed = stats.successRate >= PASS_SUCCESS_RATE && stats.p95Ms <= PASS_P95_MS;
  return {
    vus,
    durationMs,
    ...stats,
    passed,
    responseSamples: results.filter((r) => r.ok).slice(0, 4).concat(results.filter((r) => !r.ok).slice(0, 12)),
    results,
  };
}

(async () => {
  const privateN = apis.filter((a) => a.xPublic === false || a.xTokenRequired).length;
  const tokenReady =
    cfg.AUTH_TOKEN && String(cfg.AUTH_TOKEN).trim() && cfg.AUTH_TOKEN !== 'REPLACE_WITH_STAGING_JWT';
  console.log(`\nCRM PLI Portal GET APIs – ${scenario} / ${envName}`);
  console.log(`BASE_URL = ${baseUrl}`);
  console.log(`APIs     = ${apis.length} enabled (${METHOD_FILTER.join(',') || 'ALL'}; private/auth=${privateN}; POSTs deferred)`);
  console.log(`AUTH     = ${tokenReady ? 'Bearer configured' : 'MISSING — private GETs will likely 401'}`);
  console.log(`PASS_MODE= ${PASS_MODE}`);
  console.log(
    `Customers= ${customers.map((c) => `${c.customer_id}/${c.mobile_number}`).join(', ')}\n`
  );

  if (!apis.length) {
    console.error('No enabled APIs after filter (check enabled flags / CRM_METHODS).');
    process.exit(1);
  }

  if (scenario === 'once') {
    const results = [];
    let n = 0;
    for (let i = 0; i < apis.length; i++) {
      const api = apis[i];
      const contexts = needsCustomerRotation(api)
        ? customers.map((c) => ({
            ...testData,
            customer_id: String(c.customer_id),
            mobile_number: String(c.mobile_number),
          }))
        : [{ ...testData }];
      for (const ctx of contexts) {
        n += 1;
        process.stdout.write(`[${String(n).padStart(2, '0')}] `);
        await hitOne(api, results, { print: true, data: ctx });
      }
    }
    const stats = summarize(results);
    const summary = {
      finalStatus: stats.failed === 0 ? 'PASS' : 'FAIL',
      total: stats.total,
      successRate: stats.successRate,
      avgMs: stats.avgMs,
      p95Ms: stats.p95Ms,
      status0: stats.status0,
      maxPassedVus: 1,
      passRule: `PASS_MODE=${PASS_MODE}`,
    };
    console.log(`\nSummary: OK=${stats.ok} FAIL=${stats.failed} Success=${stats.successRate}% P95=${stats.p95Ms}ms`);
    writeReport(summary, [{ vus: 1, ...stats, passed: summary.finalStatus === 'PASS', responseSamples: results }], results);
    process.exit(summary.finalStatus === 'PASS' ? 0 : 1);
  }

  if (scenario === 'smoke') {
    const step = await runStep(1, 60 * 1000);
    const summary = {
      finalStatus: step.passed ? 'PASS' : 'FAIL',
      total: step.total,
      successRate: step.successRate,
      avgMs: step.avgMs,
      p95Ms: step.p95Ms,
      status0: step.status0,
      maxPassedVus: step.passed ? 1 : 0,
      stoppedAtVus: step.passed ? null : 1,
      passRule: `success>=${PASS_SUCCESS_RATE}% AND p95<=${PASS_P95_MS}ms`,
    };
    console.log(`\nSmoke: ${summary.finalStatus} success=${step.successRate}% p95=${step.p95Ms}ms`);
    writeReport(summary, [{ ...step, results: undefined }], step.responseSamples);
    process.exit(step.passed ? 0 : 1);
  }

  // load
  console.log(`Step-up load: ${STEP_VUS.join(' → ')}`);
  console.log(`Each step = ${STEP_DURATION_MS / 1000}s | Pass if success≥${PASS_SUCCESS_RATE}% and P95≤${PASS_P95_MS}ms\n`);
  const steps = [];
  const sampleResults = [];
  let maxPassedVus = 0;
  let stoppedAtVus = null;
  let finalStatus = 'PASS';

  for (const vus of STEP_VUS) {
    console.log(`▶ Step VUs=${vus} ...`);
    await sleep(1500);
    const step = await runStep(vus, STEP_DURATION_MS);
    const compact = { ...step, results: undefined };
    steps.push(compact);
    sampleResults.push(...step.responseSamples);
    console.log(
      `   ${step.passed ? 'PASS' : 'FAIL'} calls=${step.total} ok=${step.ok} fail=${step.failed} success=${step.successRate}% avg=${step.avgMs}ms p95=${step.p95Ms}ms tlsFail=${step.status0}`
    );
    if (step.passed) maxPassedVus = vus;
    else {
      finalStatus = 'FAIL';
      stoppedAtVus = vus;
      console.log(`\nStopping. Previous max passed VUs = ${maxPassedVus}. Failed at VUs=${vus}.`);
      break;
    }
  }

  const totalCalls = steps.reduce((a, s) => a + s.total, 0);
  const totalOk = steps.reduce((a, s) => a + s.ok, 0);
  const summary = {
    finalStatus,
    maxPassedVus,
    stoppedAtVus,
    total: totalCalls,
    successRate: totalCalls ? Number(((totalOk / totalCalls) * 100).toFixed(2)) : 0,
    avgMs: steps.length
      ? Number(
          (
            steps.reduce((a, s) => a + s.avgMs * s.total, 0) / Math.max(1, totalCalls)
          ).toFixed(2)
        )
      : 0,
    p95Ms: Math.max(...steps.map((s) => s.p95Ms), 0),
    status0: steps.reduce((a, s) => a + s.status0, 0),
    passRule: `success>=${PASS_SUCCESS_RATE}% AND p95<=${PASS_P95_MS}ms · PASS_MODE=${PASS_MODE}`,
  };
  writeReport(summary, steps, sampleResults);
  process.exit(finalStatus === 'PASS' ? 0 : 1);
})();
