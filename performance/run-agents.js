#!/usr/bin/env node
/**
 * Agent APIs performance test with dynamic agent_code from search.
 *
 * Flow per VU iteration:
 *  1) (setup) GET search?name=ajay → collect agent_code
 *  2) GET search?agent_code={code}
 *  3) GET keycloak-identity/{code}
 *
 * Scenarios:
 *   once  - 1 pass
 *   smoke - 1 VU for 60s
 *   load  - step-up to 1000 VUs; STOP if a step fails
 *
 *   npm run test:agents:once
 *   npm run test:agents:smoke
 *   npm run test:agents:load
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { writeFullTestReport } = require('./report-template');

const root = __dirname;
const envName = (process.argv[2] || 'staging').toLowerCase();
const scenario = (process.argv[3] || 'smoke').toLowerCase();
const cfg = JSON.parse(fs.readFileSync(path.join(root, `${envName}.env.json`), 'utf8'));
const apis = JSON.parse(fs.readFileSync(path.join(root, 'apis-agents.json'), 'utf8'));
const baseUrl = String(cfg.BASE_URL || 'https://imssit.indiapost.gov.in').replace(/\/$/, '');
const reportsDir = path.join(root, 'reports', envName);
fs.mkdirSync(reportsDir, { recursive: true });

const STEP_DURATION_MS = Number(cfg.STEP_DURATION_MS || 30000); // 30s per step
const PASS_SUCCESS_RATE = Number(cfg.PASS_SUCCESS_RATE || 75 ); // %
const PASS_P95_MS = Number(cfg.PASS_P95_MS || 200);
// Think time between journeys per VU (ms). Without this, low VUs can still flood TLS.
const THINK_TIME_MS = Number(cfg.THINK_TIME_MS || 1000);
const HEALTH_WAIT_MS = Number(cfg.HEALTH_WAIT_MS || 5 * 60 * 1000); // wait up to 5 min for TLS recovery
// Default ramp to 1000 VUs (override with STEP_VUS array in env JSON)
const STEP_VUS = Array.isArray(cfg.STEP_VUS) && cfg.STEP_VUS.length
  ? cfg.STEP_VUS.map(Number)
  : [5, 10, 25, 50, 75, 100, 150, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

// Allow enough concurrent sockets for the highest step
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: Math.max(100, Math.max(...STEP_VUS)),
  maxFreeSockets: 1000,//what is 
  timeout: 30000,
  rejectUnauthorized: false,
});

const BODY_KEEP_CHARS = Number(cfg.BODY_KEEP_CHARS || 8000);
// once = print every response; load/smoke = print first N hits per process (+ always on fail)
const PRINT_EVERY_RESPONSE = scenario === 'once' || String(cfg.PRINT_EVERY_RESPONSE || 'false') === 'true';
let printedHits = 0;
const PRINT_HIT_LIMIT = Number(cfg.PRINT_HIT_LIMIT || (scenario === 'once' ? 99999 : 30));

function formatResponse(res) {
  if (res.error && !res.body) return res.error;
  if (res.json) {
    try {
      return JSON.stringify(res.json, null, 2);
    } catch {
      /* fall through */
    }
  }
  return res.body || '';
}

function logApiHit(entry) {
  const shouldPrint =
    PRINT_EVERY_RESPONSE || !entry.ok || printedHits < PRINT_HIT_LIMIT;
  if (!shouldPrint) return;
  printedHits += 1;
  const mark = entry.ok ? 'OK ' : 'FAIL';
  console.log(`\n[${mark}] ${entry.status} ${entry.durationMs}ms  ${entry.name || ''}`);
  console.log(`  PATH: ${entry.path || entry.url}`);
  if (entry.agent_code) console.log(`  agent_code: ${entry.agent_code}`);
  if (entry.error) console.log(`  error: ${entry.error}`);
  const resp = formatResponse(entry);
  if (resp) {
    const lines = String(resp).split('\n');
    const shown = lines.slice(0, 40).join('\n');
    console.log(`  RESPONSE:\n${shown}${lines.length > 40 ? '\n  ... (truncated in console)' : ''}`);
  }
}

function request(url) {
  return new Promise((resolve) => {
    const started = Date.now();
    const headers = {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Connection: 'keep-alive',
    };
    if (cfg.AUTH_TOKEN && cfg.AUTH_TOKEN !== 'REPLACE_WITH_STAGING_JWT') {
      headers.Authorization = `Bearer ${cfg.AUTH_TOKEN}`;
    }
    const req = https.get(
      url,
      { headers, timeout: 30000, agent, rejectUnauthorized: false },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let parsed = null;
          let okBody = false;
          try {
            parsed = JSON.parse(body);
            okBody = parsed.success === true || parsed.status_code === 200;
          } catch {
            okBody = false;
          }
          const truncated = body.length > BODY_KEEP_CHARS;
          resolve({
            status: res.statusCode || 0,
            durationMs: Date.now() - started,
            ok: res.statusCode === 200 && okBody,
            body: truncated ? `${body.slice(0, BODY_KEEP_CHARS)}\n...[truncated]` : body,
            response: truncated ? `${body.slice(0, BODY_KEEP_CHARS)}\n...[truncated]` : body,
            json: parsed,
            truncated,
            error: null,
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
        truncated: false,
        error: err.message,
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
        truncated: false,
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

function fill(template, agentCode) {
  return template.replace('{agent_code}', encodeURIComponent(agentCode));
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealthy() {
  const searchUrl = `${baseUrl}${apis.searchByName.path}`;
  const deadline = Date.now() + HEALTH_WAIT_MS;
  let attempt = 0;
  console.log(`\nWaiting for gateway health (up to ${HEALTH_WAIT_MS / 1000}s)...`);
  while (Date.now() < deadline) {
    attempt += 1;
    const res = await request(searchUrl);
    if (res.ok && res.json && Array.isArray(res.json.results) && res.json.results.length) {
      const codes = res.json.results.map((r) => r.agent_code).filter(Boolean);
      console.log(`   Healthy on attempt ${attempt}: ${res.status} ${res.durationMs}ms`);
      const searchResult = {
        name: apis.searchByName.name,
        service: apis.searchByName.service,
        path: apis.searchByName.path,
        url: searchUrl,
        ...res,
      };
      logApiHit(searchResult);
      return { searchResult, codes };
    }
    const err = res.error || `HTTP ${res.status}`;
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    console.log(`   attempt ${attempt}: ${err} – retry in 10s (${left}s left)`);
    await sleep(10000);
  }
  return null;
}

async function fetchAgentCodes() {
  const healthy = await waitForHealthy();
  if (healthy && healthy.codes.length) {
    console.log(`   Codes: ${healthy.codes.join(', ')}`);
    return healthy;
  }
  // Do NOT continue load against a dead TLS path – that only creates fake failures
  throw new Error(
    'Gateway TLS still blocked (status 0). Wait 5–15 minutes after a heavy run, verify in Postman, then retry.'
  );
}

function toReportRow(entry) {
  return {
    name: entry.name,
    service: entry.service || 'pliagent-backend',
    path: entry.path || entry.url,
    agent_code: entry.agent_code || null,
    status: entry.status,
    durationMs: entry.durationMs,
    ok: entry.ok,
    error: entry.error,
    body: entry.body,
    response: entry.response || formatResponse(entry),
    json: entry.json,
    truncated: !!entry.truncated,
  };
}

async function runJourney(agentCode, results) {
  const searchPath = fill(apis.searchByAgentCode.pathTemplate, agentCode);
  const searchRes = await request(`${baseUrl}${searchPath}`);
  const searchEntry = {
    name: apis.searchByAgentCode.name,
    service: apis.searchByAgentCode.service,
    path: searchPath,
    agent_code: agentCode,
    ...searchRes,
  };
  logApiHit(searchEntry);
  results.push(searchEntry);

  const keyPath = fill(apis.keycloakIdentity.pathTemplate, agentCode);
  const keyRes = await request(`${baseUrl}${keyPath}`);
  const keyEntry = {
    name: apis.keycloakIdentity.name,
    service: apis.keycloakIdentity.service,
    path: keyPath,
    agent_code: agentCode,
    ...keyRes,
  };
  logApiHit(keyEntry);
  results.push(keyEntry);
}

function pickResponseSamples(results, maxOk = 6, maxFail = 20) {
  const fails = results.filter((r) => !r.ok).slice(0, maxFail).map(toReportRow);
  const oks = results.filter((r) => r.ok).slice(0, maxOk).map(toReportRow);
  return [...oks, ...fails];
}

async function runStep(vus, durationMs, codes) {
  const results = [];
  const stopAt = Date.now() + durationMs;
  let nextCode = 0;

  // Each VU runs paced journeys (1 journey + think time), not a tight loop
  const workers = Array.from({ length: vus }, (_, id) =>
    (async () => {
      await sleep(id * 100); // stagger VU start
      while (Date.now() < stopAt) {
        const code = codes[nextCode % codes.length];
        nextCode += 1;
        await runJourney(code, results);
        if (Date.now() >= stopAt) break;
        await sleep(THINK_TIME_MS);
      }
    })()
  );

  await Promise.all(workers);

  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const ok = results.filter((r) => r.ok).length;
  const total = results.length;
  const successRate = total ? (ok / total) * 100 : 0;
  const p95 = percentile(durations, 95);
  const avg = total ? durations.reduce((a, b) => a + b, 0) / total : 0;
  const status0 = results.filter((r) => r.status === 0).length;
  const passed = successRate >= PASS_SUCCESS_RATE && p95 <= PASS_P95_MS;

  return {
    vus,
    durationMs,
    total,
    ok,
    failed: total - ok,
    successRate: Number(successRate.toFixed(2)),
    avgMs: Number(avg.toFixed(2)),
    p95Ms: p95,
    status0,
    passed,
    results,
  };
}

function classifyFailReason(r) {
  const err = String(r.error || '').toLowerCase();
  if (r.status === 0 || err.includes('socket') || err.includes('tls') || err.includes('econn') || err.includes('hang up')) {
    return 'TLS/network (status 0 / socket hang up) – gateway closed connection before HTTP response';
  }
  if (err.includes('timeout')) return 'Request timeout';
  if (r.status && r.status !== 200) return `HTTP ${r.status}`;
  if (r.status === 200 && !r.ok) return 'HTTP 200 but body validation failed (success/status_code check)';
  return r.error || 'Unknown failure';
}

function buildFailureAnalysis(summary, steps, allResults) {
  if (summary.finalStatus === 'PASS') return [];

  const reasons = [];
  if (summary.error) {
    reasons.push({
      code: 'SETUP',
      title: 'Setup / health check failed',
      detail: String(summary.error),
    });
  }

  const failedSteps = (steps || []).filter((s) => s && s.passed === false);
  for (const s of failedSteps) {
    const parts = [];
    if (s.successRate < PASS_SUCCESS_RATE) {
      parts.push(
        `success rate ${s.successRate}% < required ${PASS_SUCCESS_RATE}% (ok=${s.ok}, fail=${s.failed}, total=${s.total})`
      );
    }
    if (s.p95Ms > PASS_P95_MS) {
      parts.push(`P95 ${s.p95Ms}ms > required ${PASS_P95_MS}ms`);
    }
    if (s.status0 > 0) {
      parts.push(`TLS/status0 failures = ${s.status0} (${Math.round((s.status0 / Math.max(1, s.total)) * 100)}% of calls)`);
    }
    reasons.push({
      code: 'STEP_FAIL',
      title: `Step failed at VUs=${s.vus}`,
      detail: parts.join('; ') || 'Step did not meet pass gate',
    });
  }

  const failHits = (allResults || [])
    .concat((steps || []).flatMap((s) => s.responseSamples || []))
    .concat((steps || []).flatMap((s) => s.sampleErrors || []))
    .filter((r) => r && (r.ok === false || (r.status != null && r.status !== 200) || r.error));

  const counts = {};
  for (const r of failHits) {
    const key = classifyFailReason(r);
    counts[key] = (counts[key] || 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    reasons.push({
      code: 'ERROR_BREAKDOWN',
      title: 'Top failure reasons (from captured samples)',
      detail: ranked.map(([k, n]) => `${k} → ${n} sample(s)`).join(' | '),
    });
  }

  // Human-readable root cause for common gateway case
  const failedStep = failedSteps[failedSteps.length - 1];
  if (failedStep && failedStep.status0 > 0 && failedStep.status0 / Math.max(1, failedStep.total) > 0.5) {
    reasons.push({
      code: 'ROOT_CAUSE',
      title: 'Likely root cause',
      detail:
        `Gateway/WAF rate-limit or connection limit on ${baseUrl}. ` +
        `At VUs=${failedStep.vus}, most requests died with status=0 / socket hang up before any API response. ` +
        `Successful calls still had low latency, so this is not application slowness.`,
    });
  }

  if (summary.stoppedAtVus != null) {
    reasons.push({
      code: 'STOP',
      title: 'Run stopped',
      detail: `Stopped at VUs=${summary.stoppedAtVus}. Max passed VUs=${summary.maxPassedVus ?? 0}.`,
    });
  }

  return reasons;
}

function writeReport(summary, steps, allResults) {
  const stepList = STEP_VUS.join('→');
  const avgMs =
    steps.length && steps.every((s) => s.avgMs != null)
      ? Number(
          (
            steps.reduce((a, s) => a + Number(s.avgMs) * Number(s.total || 0), 0) /
            Math.max(1, steps.reduce((a, s) => a + Number(s.total || 0), 0))
          ).toFixed(2)
        )
      : undefined;

  // Prefer explicit response samples from steps; else use allResults
  const fromSteps = (steps || []).flatMap((s) => s.responseSamples || []);
  const fromAll = (allResults || []).filter((r) => r && (r.path || r.url)).map(toReportRow);
  const apiDetail =
    scenario === 'once'
      ? fromAll
      : [...fromSteps, ...fromAll].slice(0, scenario === 'smoke' ? 200 : 300);

  const failureReasons = buildFailureAnalysis(summary, steps, allResults);
  if (failureReasons.length) {
    console.log('\nFailure reasons:');
    for (const f of failureReasons) {
      console.log(`  - [${f.code}] ${f.title}: ${f.detail}`);
    }
  }

  return writeFullTestReport({
    reportsDir,
    filePrefix: `agents-${scenario}`,
    title: `Agent APIs – ${scenario} Test Report`,
    envName,
    scenario,
    baseUrl,
    summary: { ...summary, avgMs, failureReasons },
    steps,
    apis: apiDetail,
    failureReasons,
    preparedBy: cfg.REPORT_PREPARED_BY || 'Neeshu Kumar',
    reportAudience: cfg.REPORT_AUDIENCE || 'client',
    coverage: {
      configuredApis: 3,
      enabledApis: 3,
      plannedVus: STEP_VUS,
    },
    keepRuns: Number(cfg.KEEP_REPORT_RUNS || 2),
    objective: [
      'Validate Agent search and Keycloak identity APIs under the selected scenario.',
      'Confirm success rate and P95 latency stay within defined pass gates.',
    ],
    scope: [
      `Setup: <code>${apis.searchByName.path}</code>`,
      `Journey: <code>${apis.searchByAgentCode.pathTemplate}</code>`,
      `Journey: <code>${apis.keycloakIdentity.pathTemplate}</code>`,
      `Agent codes used: <code>${(summary.agentCodesUsed || []).join(', ') || 'n/a'}</code>`,
    ],
    loadModel:
      scenario === 'load'
        ? [
            `Step-up VUs: <strong>${stepList}</strong>`,
            `Each step duration: <strong>${STEP_DURATION_MS / 1000}s</strong>`,
            `Think time per VU: <strong>${THINK_TIME_MS}ms</strong>`,
            `Pass gate: success ≥ <strong>${PASS_SUCCESS_RATE}%</strong> AND P95 ≤ <strong>${PASS_P95_MS}ms</strong>`,
            'Stop on first failing step',
          ]
        : scenario === 'smoke'
          ? [
              '1 VU for 60 seconds',
              `Think time per VU: <strong>${THINK_TIME_MS}ms</strong>`,
              `Pass gate: success ≥ <strong>${PASS_SUCCESS_RATE}%</strong> AND P95 ≤ <strong>${PASS_P95_MS}ms</strong>`,
            ]
          : [
              'Single pass over discovered agent codes (once)',
              'Each code runs search-by-code + keycloak-identity',
            ],
    observations: [
      summary.finalStatus === 'PASS'
        ? `Run completed successfully${summary.maxPassedVus != null ? ` up to <strong>${summary.maxPassedVus}</strong> VUs` : ''}.`
        : `Run failed${summary.stoppedAtVus != null ? ` at VUs=<strong>${summary.stoppedAtVus}</strong>` : ''}.`,
      `Overall success rate: <strong>${summary.successRate}%</strong> across <strong>${summary.total}</strong> calls.`,
      summary.passRule ? `Pass rule: <code>${summary.passRule}</code>` : 'Pass rule derived from scenario thresholds.',
      ...failureReasons.map((f) => `<strong>${f.title}:</strong> ${f.detail}`),
    ],
    recommendations:
      summary.finalStatus === 'PASS'
        ? [
            'Keep this report as evidence for staging capacity of the Agent journey.',
            'Optional next: increase max VUs, reduce think time, or add authenticated write APIs.',
          ]
        : [
            'If failures show TLS/status=0, wait for gateway recovery and re-run.',
            'Check Postman connectivity to the same BASE_URL before retesting.',
            'Review failed rows / sample errors in the JSON report.',
          ],
    open: true,
  });
}

(async () => {
  console.log(`\nAgent APIs performance – ${scenario} / ${envName}`);
  console.log(`BASE_URL = ${baseUrl}`);

  try {
    const { searchResult, codes } = await fetchAgentCodes();
    if (!codes.length) {
      throw new Error('No agent codes available from search or fallback.');
    }

    const allResults = [];
    if (searchResult) allResults.push(searchResult);
    const steps = [];

    if (scenario === 'once') {
      console.log('\nRunning once for each agent_code');
      for (const code of codes) {
        await runJourney(code, allResults);
      }
      const ok = allResults.filter((r) => r.ok).length;
      const summary = {
        finalStatus: ok === allResults.length ? 'PASS' : 'FAIL',
        maxPassedVus: 1,
        stoppedAtVus: null,
        total: allResults.length,
        successRate: Number(((ok / allResults.length) * 100).toFixed(2)),
        agentCodesUsed: codes,
        passRule: 'all once requests must succeed',
      };
      writeReport(
        summary,
        [
          {
            vus: 1,
            ...summarize(allResults),
            passed: summary.finalStatus === 'PASS',
            responseSamples: allResults.map(toReportRow),
          },
        ],
        allResults
      );
      process.exit(summary.finalStatus === 'PASS' ? 0 : 1);
    }

    if (scenario === 'smoke') {
      console.log('\nSmoke: 1 VU for 60s');
      const step = await runStep(1, 60 * 1000, codes);
      steps.push({
        ...step,
        results: undefined,
        responseSamples: pickResponseSamples(step.results, 20, 40),
      });
      allResults.push(...pickResponseSamples(step.results, 20, 40));
      const summary = {
        finalStatus: step.passed ? 'PASS' : 'FAIL',
        maxPassedVus: step.passed ? 1 : 0,
        stoppedAtVus: step.passed ? null : 1,
        total: step.total,
        successRate: step.successRate,
        agentCodesUsed: codes,
        passRule: `success>=${PASS_SUCCESS_RATE}% AND p95<=${PASS_P95_MS}ms`,
      };
      console.log(
        `Smoke result: ${step.passed ? 'PASS' : 'FAIL'} success=${step.successRate}% p95=${step.p95Ms}ms`
      );
      writeReport(summary, steps, allResults);
      process.exit(step.passed ? 0 : 1);
    }

    // LOAD: step up — stop on first failing step
    console.log(`\nStep-up load: ${STEP_VUS.join(' → ')}`);
    console.log(
      `Each step = ${STEP_DURATION_MS / 1000}s | Pass if success≥${PASS_SUCCESS_RATE}% and P95≤${PASS_P95_MS}ms\n`
    );

    let maxPassedVus = 0;
    let stoppedAtVus = null;
    let finalStatus = 'PASS';

    for (const vus of STEP_VUS) {
      console.log(`▶ Step VUs=${vus} ...`);
      await sleep(2000);
      const step = await runStep(vus, STEP_DURATION_MS, codes);
      const responseSamples = pickResponseSamples(step.results, 4, 15);
      const sampleErrors = step.results
        .filter((r) => !r.ok)
        .slice(0, 5)
        .map((r) => ({
          path: r.path,
          status: r.status,
          error: r.error,
          body: r.body,
          response: r.response || formatResponse(r),
          failReason: classifyFailReason(r),
        }));
      const failReasonText = !step.passed
        ? [
            step.successRate < PASS_SUCCESS_RATE
              ? `success ${step.successRate}% < ${PASS_SUCCESS_RATE}%`
              : null,
            step.p95Ms > PASS_P95_MS ? `P95 ${step.p95Ms}ms > ${PASS_P95_MS}ms` : null,
            step.status0 > 0 ? `TLS/status0=${step.status0}` : null,
            sampleErrors[0]?.error || sampleErrors[0]?.failReason || null,
          ]
            .filter(Boolean)
            .join(' · ')
        : '';
      const compact = {
        ...step,
        results: undefined,
        responseSamples,
        sampleErrors,
        failReason: failReasonText,
      };
      steps.push(compact);
      allResults.push(...responseSamples);

      console.log(
        `   ${step.passed ? 'PASS' : 'FAIL'} calls=${step.total} ok=${step.ok} fail=${step.failed} success=${step.successRate}% avg=${step.avgMs}ms p95=${step.p95Ms}ms tlsFail=${step.status0}`
      );
      if (!step.passed && failReasonText) {
        console.log(`   Reason: ${failReasonText}`);
      }

      if (step.passed) {
        maxPassedVus = vus;
      } else {
        finalStatus = 'FAIL';
        stoppedAtVus = vus;
        console.log(`\nStopping. Previous max passed VUs = ${maxPassedVus}. Failed at VUs=${vus}.`);
        console.log(`Failure reason: ${failReasonText}`);
        break;
      }
    }

    if (finalStatus === 'PASS') {
      console.log(`\nAll steps passed up to ${maxPassedVus} VUs.`);
    }

    const totalCalls = steps.reduce((a, s) => a + s.total, 0);
    const totalOk = steps.reduce((a, s) => a + s.ok, 0);
    const summary = {
      finalStatus,
      maxPassedVus,
      stoppedAtVus,
      total: totalCalls,
      successRate: totalCalls ? Number(((totalOk / totalCalls) * 100).toFixed(2)) : 0,
      agentCodesUsed: codes,
      passRule: `success>=${PASS_SUCCESS_RATE}% AND p95<=${PASS_P95_MS}ms`,
    };

    writeReport(summary, steps, allResults);
    process.exit(finalStatus === 'PASS' ? 0 : 1);
  } catch (err) {
    console.error(`\n${err.message || err}`);
    writeReport(
      {
        finalStatus: 'FAIL',
        maxPassedVus: 0,
        stoppedAtVus: null,
        total: 0,
        successRate: 0,
        agentCodesUsed: [],
        passRule: `success>=${PASS_SUCCESS_RATE}% AND p95<=${PASS_P95_MS}ms`,
        error: String(err.message || err),
      },
      [],
      [{ name: 'setup', path: apis.searchByName.path, status: 0, durationMs: 0, ok: false, error: String(err.message || err) }]
    );
    process.exit(1);
  }
})();

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
    p95Ms: percentile(durations, 95),
    status0: results.filter((r) => r.status === 0).length,
  };
}
