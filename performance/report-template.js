/**
 * Shared full HTML test-report generator.
 * Called after every once / smoke / load run.
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openReport(htmlPath) {
  if (process.platform === 'win32') {
    exec(`cmd /c start "" "${htmlPath}"`);
  } else if (process.platform === 'darwin') {
    exec(`open "${htmlPath}"`);
  } else {
    exec(`xdg-open "${htmlPath}"`);
  }
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PII_KEYS = new Set([
  'name',
  'email',
  'email_id',
  'mobile',
  'mobile_no',
  'mobile_number',
  'address',
  'date_of_birth',
  'dob',
  'customer_id',
  'agent_name',
  'customer_details',
  'userdetails',
]);

function isPiiKey(key) {
  const lk = String(key || '').toLowerCase();
  if (!lk) return false;
  if (PII_KEYS.has(lk)) return true;
  if (lk.includes('email') || lk.includes('mobile') || lk.includes('phone')) return true;
  if (lk.includes('address') || lk.includes('birth') || lk === 'dob') return true;
  if (lk.includes('customer_id') || lk === 'agent_id' || lk === 'agent_name') return true;
  if (
    lk.includes('name') &&
    !['office_name', 'ho_name', 'city_name', 'state_name', 'branch_name', 'scheme_name'].includes(lk)
  ) {
    return true;
  }
  return false;
}

function redactScalar(key, value) {
  const k = String(key || '').toLowerCase();
  if (k.includes('email')) return 'test@example.com';
  if (k.includes('mobile') || k.includes('phone')) return 'XXXXXXXXXX';
  if (k.includes('address')) return 'REDACTED';
  if (k.includes('birth') || k === 'dob') return 'REDACTED';
  if (
    k.includes('name') &&
    !['office_name', 'ho_name', 'city_name', 'state_name', 'branch_name', 'scheme_name'].includes(k)
  ) {
    return 'TEST CUSTOMER';
  }
  if (k.includes('customer_id') || k === 'agent_id') return 'REDACTED';
  if (typeof value === 'number' && k.includes('customer')) return 0;
  if (typeof value === 'string' && value.length > 80 && /@|\d{6,}/.test(value)) return 'REDACTED';
  if (typeof value === 'string' && /@/.test(value)) return 'test@example.com';
  if (typeof value === 'string' && /^\d{10}$/.test(value)) return 'XXXXXXXXXX';
  return typeof value === 'string' ? 'REDACTED' : value;
}

function sanitizeJson(value, key) {
  if (Array.isArray(value)) {
    // Nested PII containers (e.g. UserDetails[]): deep-sanitize each element
    if (isPiiKey(key) && value.every((v) => v && typeof v === 'object')) {
      return value.map((v) => sanitizeJson(v, key));
    }
    if (isPiiKey(key)) return value.map((v) => redactScalar(key, v));
    return value.map((v) => sanitizeJson(v, key));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v && typeof v === 'object') {
        // Always recurse into objects/arrays so nested PII is cleaned
        out[k] = sanitizeJson(v, k);
      } else if (isPiiKey(k)) {
        out[k] = redactScalar(k, v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return isPiiKey(key) ? redactScalar(key, value) : value;
}

function scrubPiiInPlainText(text) {
  return String(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'test@example.com')
    .replace(/\b\d{10}\b/g, 'XXXXXXXXXX')
    .replace(/"(name|customer_name|full_name)"\s*:\s*"[^"]*"/gi, '"$1":"TEST CUSTOMER"')
    .replace(/"(address|residential_address)"\s*:\s*"[^"]*"/gi, '"$1":"REDACTED"')
    .replace(/"(date_of_birth|dob)"\s*:\s*"[^"]*"/gi, '"$1":"REDACTED"')
    .replace(/"(email|email_id)"\s*:\s*"[^"]*"/gi, '"$1":"test@example.com"')
    .replace(/"(mobile|mobile_no|mobile_number|phone)"\s*:\s*"[^"]*"/gi, '"$1":"XXXXXXXXXX"')
    .replace(/"(customer_id)"\s*:\s*("?)[^",}\s]+\2/gi, '"$1":"REDACTED"');
}

function sanitizeResponseText(text) {
  if (!text) return text;
  try {
    return JSON.stringify(sanitizeJson(JSON.parse(text)), null, 2);
  } catch {
    return scrubPiiInPlainText(text);
  }
}

function dedupeApiSamples(apis, maxPerPath = 1) {
  const seen = new Map();
  const out = [];
  for (const r of apis || []) {
    const key = `${r.method || 'GET'} ${r.path || r.url || r.name || ''}`;
    const n = seen.get(key) || 0;
    if (n >= maxPerPath) continue;
    seen.set(key, n + 1);
    out.push(r);
  }
  return out;
}

/**
 * Keep only the newest N runs for a filePrefix.
 * Deletes older `${prefix}-{stamp}.json|.html` and `${prefix}-report-{stamp}.html`.
 */
function cleanupOldReports(reportsDir, filePrefix, keep = 2) {
  const keepN = Math.max(1, Number(keep) || 2);
  if (!fs.existsSync(reportsDir)) return { kept: 0, deleted: 0 };

  const stampRe = new RegExp(
    `^${escapeRegExp(filePrefix)}-(?:report-)?(\\d{4}-\\d{2}-\\d{2}T[\\d-]+Z)\\.(json|html)$`
  );
  const files = fs.readdirSync(reportsDir);
  const stamps = new Set();
  for (const f of files) {
    const m = f.match(stampRe);
    if (m) stamps.add(m[1]);
  }
  const sorted = [...stamps].sort().reverse(); // newest first
  const keepSet = new Set(sorted.slice(0, keepN));
  let deleted = 0;
  for (const f of files) {
    const m = f.match(stampRe);
    if (!m || keepSet.has(m[1])) continue;
    try {
      fs.unlinkSync(path.join(reportsDir, f));
      deleted += 1;
    } catch {
      /* ignore locked files */
    }
  }
  if (deleted) {
    console.log(
      `Report cleanup: deleted ${deleted} old file(s); kept last ${keepSet.size} run(s) for "${filePrefix}"`
    );
  }
  return { kept: keepSet.size, deleted };
}

/**
 * @param {object} opts
 * @param {string} opts.reportsDir
 * @param {string} opts.filePrefix - e.g. agents-load / collection-once
 * @param {string} opts.title
 * @param {string} opts.envName
 * @param {string} opts.scenario
 * @param {string} opts.baseUrl
 * @param {object} opts.summary
 * @param {Array<object>} [opts.steps]
 * @param {Array<object>} [opts.apis]
 * @param {string[]} [opts.objective]
 * @param {string[]} [opts.scope]
 * @param {string[]} [opts.loadModel]
 * @param {string[]} [opts.observations]
 * @param {string[]} [opts.recommendations]
 * @param {Array<{code:string,title:string,detail:string}>} [opts.failureReasons]
 * @param {boolean} [opts.open=true]
 */
function writeFullTestReport(opts) {
  const {
    reportsDir,
    filePrefix,
    title,
    envName,
    scenario,
    baseUrl,
    summary,
    steps = [],
    apis = [],
    objective = [],
    scope = [],
    loadModel = [],
    observations = [],
    recommendations = [],
    failureReasons = summary.failureReasons || [],
    preparedBy = '',
    reportAudience = 'client', // client = PII redacted; internal = raw samples
    coverage = summary.coverage || {},
    open = true,
    keepRuns = 2,
  } = opts;
  const preparedByName = String(preparedBy || summary.preparedBy || '').trim();
  const audience = String(reportAudience || summary.reportAudience || 'client').toLowerCase();
  const redactPii = audience !== 'internal';

  fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const generatedAt = new Date().toISOString();
  const jsonPath = path.join(reportsDir, `${filePrefix}-${stamp}.json`);
  const htmlPath = path.join(reportsDir, `${filePrefix}-${stamp}.html`);
  const formalPath = path.join(reportsDir, `${filePrefix}-report-${stamp}.html`);
  const runsToKeep = Number(keepRuns) > 0 ? Number(keepRuns) : 2;

  const finalStatus = summary.finalStatus || (summary.failed ? 'FAIL' : 'PASS');
  const isPass = finalStatus === 'PASS';
  const statusColor = isPass ? 'var(--ok)' : 'var(--bad)';

  const worstP95 = steps.length
    ? Math.max(...steps.map((s) => Number(s.p95Ms) || 0))
    : summary.p95Ms || summary.latencyMs?.p95 || 0;
  const totalTls = steps.length
    ? steps.reduce((a, s) => a + (Number(s.status0) || 0), 0)
    : summary.status0 || 0;

  const plannedVus = coverage.plannedVus || summary.plannedVus || null;
  const achievedVus = summary.maxPassedVus != null ? summary.maxPassedVus : null;
  const configuredApis = coverage.configuredApis ?? summary.configuredApis ?? null;
  const enabledApis = coverage.enabledApis ?? summary.enabledApis ?? null;
  const uniqueExecuted = [
    ...new Set(
      (apis || [])
        .map((a) => `${a.method || 'GET'} ${a.path || a.url || ''}`)
        .filter((x) => x.trim().length > 4)
    ),
  ];
  const uniqueFromSteps = [
    ...new Set(
      (steps || [])
        .flatMap((s) => s.responseSamples || [])
        .map((a) => `${a.method || 'GET'} ${a.path || ''}`)
        .filter((x) => x.trim().length > 4)
    ),
  ];
  const executedUnique = uniqueExecuted.length ? uniqueExecuted : uniqueFromSteps;

  // Client reports: redact PII and keep one sample per endpoint
  let displayApis = dedupeApiSamples(apis || [], audience === 'client' ? 1 : 2);
  if (redactPii) {
    displayApis = displayApis.map((r) => {
      const copy = { ...r };
      if (copy.json) copy.json = sanitizeJson(copy.json);
      if (copy.response) copy.response = sanitizeResponseText(copy.response);
      if (copy.body) copy.body = sanitizeResponseText(copy.body);
      if (copy.customer_id) copy.customer_id = 'REDACTED';
      if (copy.mobile_number) copy.mobile_number = 'XXXXXXXXXX';
      if (copy.agent_code && String(copy.agent_code).length > 4) {
        /* keep agent codes for agents suite – not PII names */
      }
      return copy;
    });
  }

  const totalDurationSec = (steps || []).reduce((a, s) => a + Number(s.durationMs || 0), 0) / 1000;
  const approxRps =
    totalDurationSec > 0 && summary.total
      ? Number((Number(summary.total) / totalDurationSec).toFixed(2))
      : null;

  function stepFailReason(s) {
    if (s.passed) return '—';
    if (s.failReason) return s.failReason;
    const bits = [];
    if (s.successRate != null) bits.push(`success ${s.successRate}%`);
    if ((s.status0 || 0) > 0) bits.push(`TLS/status0=${s.status0}`);
    if (s.sampleErrors && s.sampleErrors.length) {
      const top = s.sampleErrors.find((e) => e.error || e.failReason) || s.sampleErrors[0];
      if (top?.failReason) bits.push(top.failReason);
      else if (top?.error) bits.push(top.error);
      else if (top?.status === 0) bits.push('status 0 / no HTTP response');
    }
    if (s.responseSamples) {
      const errSample = s.responseSamples.find((r) => r.error || r.ok === false);
      if (errSample?.error && !bits.includes(errSample.error)) bits.push(errSample.error);
    }
    return bits.join(' · ') || 'Step failed pass gate';
  }

  const stepRows = steps
    .map((s) => {
      const pass = !!s.passed;
      return `<tr class="${pass ? 'pass' : 'fail'}">
        <td>${esc(s.vus)}</td>
        <td>${esc(s.total)}</td>
        <td>${esc(s.ok)}</td>
        <td>${esc(s.failed)}</td>
        <td>${esc(s.successRate)}%</td>
        <td>${esc(s.avgMs)}</td>
        <td>${esc(s.p95Ms)}</td>
        <td>${esc(s.status0 ?? 0)}</td>
        <td class="${pass ? 'pass-pill' : 'fail-pill'}">${pass ? 'PASS' : 'FAIL'}</td>
        <td class="reason">${esc(stepFailReason(s))}</td>
      </tr>`;
    })
    .join('');

  const failureSection =
    !isPass && failureReasons.length
      ? `<h2>Failure reasons</h2>
    <div class="panel fail-box">
      ${failureReasons
        .map(
          (f) => `<div class="fail-item">
        <div class="fail-title">[${esc(f.code)}] ${esc(f.title)}</div>
        <div>${esc(f.detail)}</div>
      </div>`
        )
        .join('')}
    </div>`
      : !isPass
        ? `<h2>Failure reasons</h2>
    <div class="panel fail-box"><p style="margin:0">Run failed. See failed steps / API rows below for details.</p></div>`
        : '';

  const maxP95ForBars = Math.max(worstP95, 1);
  const p95Bars = steps
    .map((s) => {
      const pct = Math.max(4, Math.round((Number(s.p95Ms) / maxP95ForBars) * 100));
      return `<div class="chart"><div>${esc(s.vus)} VU</div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><div>${esc(s.p95Ms)} ms</div></div>`;
    })
    .join('');

  function responseText(r) {
    if (r.response) return String(r.response);
    if (r.json) {
      try {
        return JSON.stringify(r.json, null, 2);
      } catch {
        /* ignore */
      }
    }
    if (r.body) return String(r.body);
    if (r.error) return String(r.error);
    return '';
  }

  const apiRows = displayApis
    .map((r, idx) => {
      const ok = r.ok === true || r.status === 200;
      const resp = responseText(r);
      return `<tr class="${ok ? 'pass' : 'fail'}">
        <td>${idx + 1}</td>
        <td>${esc(r.name || r.service || '-')}${r.agent_code ? `<div class="muted">agent_code: ${esc(r.agent_code)}</div>` : ''}</td>
        <td><code>${esc(r.path || r.url || '')}</code></td>
        <td>${esc(r.status)}</td>
        <td>${esc(r.durationMs)}</td>
        <td class="${ok ? 'pass-pill' : 'fail-pill'}">${ok ? 'PASS' : 'FAIL'}</td>
      </tr>
      <tr class="${ok ? 'pass' : 'fail'}">
        <td colspan="6">
          <div class="resp-label">Response${redactPii ? ' (PII redacted)' : ''}${r.error ? ` / Error: ${esc(r.error)}` : ''}</div>
          <pre class="resp">${esc(resp || '(empty)')}</pre>
        </td>
      </tr>`;
    })
    .join('');

  const responseCards = displayApis
    .map((r, idx) => {
      const ok = r.ok === true || r.status === 200;
      const resp = responseText(r);
      const failWhy = !ok
        ? r.error ||
          (r.status === 0
            ? 'status 0 – no HTTP response (TLS/network)'
            : r.status !== 200
              ? `HTTP ${r.status}`
              : 'body validation failed')
        : '';
      return `<div class="hit ${ok ? 'hit-ok' : 'hit-bad'}">
        <div class="hit-head">
          <strong>#${idx + 1} ${esc(r.name || r.service || 'API')}</strong>
          <span class="${ok ? 'pass-pill' : 'fail-pill'}">${ok ? 'PASS' : 'FAIL'}</span>
          <span class="muted">${esc(r.status)} · ${esc(r.durationMs)}ms</span>
        </div>
        <div><code>${esc(r.path || r.url || '')}</code></div>
        ${!ok ? `<div class="fail-pill">Fail reason: ${esc(failWhy)}</div>` : ''}
        ${r.error ? `<div class="fail-pill">error: ${esc(r.error)}</div>` : ''}
        <pre class="resp">${esc(resp || (failWhy ? `(no body) ${failWhy}` : '(empty)'))}</pre>
      </div>`;
    })
    .join('');

  const list = (items) =>
    items.length
      ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
      : '<p class="muted">—</p>';

  const stopReason =
    summary.stoppedAtVus != null
      ? `Execution stopped at <strong>VUs=${esc(summary.stoppedAtVus)}</strong> (max passed VUs=<strong>${esc(summary.maxPassedVus ?? 0)}</strong>). Planned ramp was not fully completed.`
      : isPass
        ? `All planned steps completed (max passed VUs=<strong>${esc(summary.maxPassedVus ?? '-')}</strong>).`
        : 'Run did not meet pass gates.';

  const execSummary = `
      <p style="margin:0 0 10px"><strong>Environment:</strong> <code>${esc(envName)}</code> (staging/non-production unless explicitly stated). Results must <strong>not</strong> be represented as production capacity.</p>
      <p style="margin:0 0 10px">${
        isPass
          ? `Executed steps/APIs <strong>passed</strong> against <code>${esc(baseUrl)}</code>.`
          : `Run <strong>FAILED</strong> against <code>${esc(baseUrl)}</code>. This is a preliminary execution record — <strong>not</strong> a conclusion that the entire application failed performance testing.`
      }</p>
      <p style="margin:0 0 10px">${stopReason}</p>
      <p style="margin:0"><strong>Coverage:</strong> configured=${esc(configuredApis ?? 'n/a')}, enabled=${esc(enabledApis ?? 'n/a')}, unique endpoints in samples=${esc(executedUnique.length)}, total calls=${esc(summary.total ?? 0)}${approxRps != null ? `, approx RPS across steps≈${esc(approxRps)}` : ''}.</p>
    `;

  const coverageSection = `<h2>API coverage (configured vs executed)</h2>
    <div class="panel">
      <ul>
        <li>Configured / inventory APIs: <strong>${esc(configuredApis ?? 'n/a')}</strong></li>
        <li>Enabled for this run: <strong>${esc(enabledApis ?? 'n/a')}</strong></li>
        <li>Unique endpoints evidenced in report samples: <strong>${esc(executedUnique.length)}</strong></li>
        <li>Planned VUs: <strong>${esc(Array.isArray(plannedVus) ? plannedVus.join(' → ') : plannedVus ?? 'n/a')}</strong></li>
        <li>Achieved max passed VUs: <strong>${esc(achievedVus ?? 0)}</strong>${summary.stoppedAtVus != null ? ` · stopped at VUs=<strong>${esc(summary.stoppedAtVus)}</strong>` : ''}</li>
      </ul>
      ${
        executedUnique.length
          ? `<p class="muted">Executed unique endpoints:</p><ul>${executedUnique
              .slice(0, 40)
              .map((p) => `<li><code>${esc(p)}</code></li>`)
              .join('')}</ul>`
          : ''
      }
      <p class="muted" style="margin-bottom:0">Skipped / not evidenced here may include disabled POSTs or endpoints not reached because the step-up stopped early.</p>
    </div>`;

  const rcaSection = !isPass
    ? `<h2>Root cause &amp; remediation</h2>
    <div class="panel fail-box">
      <ul>
        <li><strong>Keep FAIL verdict</strong> — do not restate as PASS for presentability.</li>
        <li>If P95 ≫ threshold while success≈100%: latency SLO mismatch or slow endpoints (e.g. profile/send-id ~2–3s vs 200ms gate) — split SLAs by API class or raise CRM P95 for those GETs.</li>
        <li>If stopped at low VUs: no concurrency evidence yet — re-run after threshold/API-mix alignment to complete ramp.</li>
        <li>Enable POST APIs only with valid non-production payloads; keep PII redacted in client reports.</li>
        <li>Retest and publish a separate sanitised client deliverable once stages pass.</li>
      </ul>
    </div>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(title)} – ${esc(envName)} – ${esc(stamp)}</title>
  <style>
    :root {
      --bg:#0b1220; --panel:#121a2b; --panel2:#182235; --line:#2a3650;
      --text:#e8eef9; --muted:#93a0b8; --ok:#22c55e; --bad:#f43f5e;
      --ok-bg:rgba(34,197,94,.12); --bad-bg:rgba(244,63,94,.12); --accent:#38bdf8;
    }
    *{box-sizing:border-box}
    body{margin:0;font-family:"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.45}
    .wrap{max-width:1100px;margin:0 auto;padding:32px 24px 64px}
    header{border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:28px}
    .eyebrow{color:var(--accent);font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px}
    h1{margin:0 0 8px;font-size:28px;font-weight:650}
    .sub{color:var(--muted);margin:0}
    .badge{display:inline-block;margin-top:14px;padding:6px 12px;border-radius:999px;font-weight:700;font-size:13px;border:1px solid}
    .badge.pass{background:var(--ok-bg);color:var(--ok);border-color:rgba(34,197,94,.35)}
    .badge.fail{background:var(--bad-bg);color:var(--bad);border-color:rgba(244,63,94,.35)}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:22px 0 28px}
    .stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
    .stat .label{color:var(--muted);font-size:12px;margin-bottom:6px}
    .stat .value{font-size:22px;font-weight:700}
    h2{font-size:18px;margin:28px 0 12px}
    h3{font-size:15px;margin:18px 0 8px;color:#cbd5e1}
    .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{border:1px solid var(--line);padding:9px 10px;text-align:left;vertical-align:top}
    th{background:var(--panel2);color:#cbd5e1;font-weight:600}
    tr.pass td{background:rgba(34,197,94,.08)}
    tr.fail td{background:rgba(244,63,94,.08)}
    .pass-pill{color:var(--ok);font-weight:700}
    .fail-pill{color:var(--bad);font-weight:700}
    ul{margin:8px 0 0;padding-left:18px;color:#dbe4f5}
    li{margin:4px 0}
    code{font-family:ui-monospace,Consolas,monospace;background:#0a101b;border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:12px}
    .chart{display:grid;grid-template-columns:64px 1fr 70px;gap:8px;align-items:center;margin:6px 0;font-size:12px}
    .bar-track{height:10px;background:#0a101b;border:1px solid var(--line);border-radius:999px;overflow:hidden}
    .bar-fill{height:100%;background:var(--accent);border-radius:999px}
    .muted{color:var(--muted)}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    @media (max-width:800px){.two-col{grid-template-columns:1fr}}
    footer{margin-top:36px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:14px}
    .resp-label{font-size:12px;color:var(--muted);margin:0 0 6px}
    pre.resp{margin:0;white-space:pre-wrap;word-break:break-word;background:#0a101b;border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:12px;max-height:320px;overflow:auto;color:#dbe4f5}
    .hit{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 12px;background:var(--panel2)}
    .hit-ok{border-color:rgba(34,197,94,.35)}
    .hit-bad{border-color:rgba(244,63,94,.35)}
    .hit-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
    .fail-box{border-color:rgba(244,63,94,.45);background:rgba(244,63,94,.08)}
    .fail-item{padding:10px 0;border-bottom:1px solid var(--line)}
    .fail-item:last-child{border-bottom:0;padding-bottom:0}
    .fail-title{color:var(--bad);font-weight:700;margin-bottom:4px}
    td.reason{font-size:12px;color:#fecdd3;max-width:360px}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <p class="eyebrow">PLI IMS · Performance Testing · ${esc(audience.toUpperCase())} REPORT</p>
      <h1>${esc(title)}</h1>
      <p class="sub">Environment: <strong>${esc(envName)}</strong> (non-production) · Scenario: <strong>${esc(scenario)}</strong> · Generated: <strong>${esc(generatedAt)}</strong></p>
      ${
        preparedByName
          ? `<p class="sub">Prepared by: <strong>${esc(preparedByName)}</strong></p>`
          : ''
      }
      <p class="sub">Run ID: <code>${esc(filePrefix)}-${esc(stamp)}</code>${redactPii ? ' · PII redacted' : ''}</p>
      <span class="badge ${isPass ? 'pass' : 'fail'}">FINAL RESULT: ${esc(finalStatus)}${
        summary.maxPassedVus != null ? ` · Max passed VUs = ${esc(summary.maxPassedVus)}` : ''
      }${summary.stoppedAtVus != null ? ` · Stopped at VUs=${esc(summary.stoppedAtVus)}` : ''}</span>
    </header>

    <div class="grid">
      <div class="stat"><div class="label">Final status</div><div class="value" style="color:${statusColor}">${esc(finalStatus)}</div></div>
      <div class="stat"><div class="label">Total calls / APIs</div><div class="value">${esc(summary.total ?? 0)}</div></div>
      <div class="stat"><div class="label">Success %</div><div class="value">${esc(summary.successRate ?? 0)}%</div></div>
      <div class="stat"><div class="label">Avg ms</div><div class="value">${esc(summary.avgMs ?? summary.latencyMs?.avg ?? '-')}</div></div>
      <div class="stat"><div class="label">P95 / worst P95</div><div class="value">${esc(worstP95 || summary.latencyMs?.p95 || '-')} ms</div></div>
      <div class="stat"><div class="label">TLS / status-0</div><div class="value">${esc(totalTls)}</div></div>
    </div>

    <h2>1. Test objective</h2>
    <div class="panel">${list(objective)}</div>

    <h2>2. Scope</h2>
    <div class="two-col">
      <div class="panel">
        <h3>Target</h3>
        <ul>
          <li>Base URL: <code>${esc(baseUrl)}</code></li>
          <li>Environment: <code>${esc(envName)}</code></li>
          <li>Scenario: <code>${esc(scenario)}</code></li>
        </ul>
      </div>
      <div class="panel">
        <h3>Covered items</h3>
        ${list(scope)}
      </div>
    </div>

    <h2>3. Load / execution model</h2>
    <div class="panel">${list(loadModel)}</div>

    <h2>4. Executive summary</h2>
    <div class="panel">${execSummary}</div>

    ${coverageSection}

    ${failureSection}

    ${rcaSection}

    ${
      steps.length
        ? `<h2>5. Step results</h2>
    <div class="panel" style="padding:0;overflow:auto">
      <table>
        <thead><tr><th>VUs</th><th>Calls</th><th>OK</th><th>Fail</th><th>Success %</th><th>Avg (ms)</th><th>P95 (ms)</th><th>TLS/status0</th><th>Result</th><th>Fail reason</th></tr></thead>
        <tbody>${stepRows}</tbody>
      </table>
    </div>
    <h2>6. Latency trend (P95 by VU step)</h2>
    <div class="panel">
      <p class="muted" style="margin-top:0;font-size:12px">Bars relative to worst P95 in this run (${esc(worstP95)} ms).</p>
      ${p95Bars || '<p class="muted">No step data</p>'}
    </div>`
        : ''
    }

    ${
      displayApis.length
        ? `<h2>${steps.length ? '7' : '5'}. API hit results (with response)</h2>
    <div class="panel" style="padding:0;overflow:auto">
      <table>
        <thead><tr><th>#</th><th>API</th><th>Path</th><th>Status</th><th>ms</th><th>Result</th></tr></thead>
        <tbody>${apiRows}</tbody>
      </table>
    </div>
    <h2>${steps.length ? '8' : '6'}. Response detail cards</h2>
    <div class="panel">
      <p class="muted" style="margin-top:0">${
        redactPii
          ? 'Sanitised response samples (PII redacted; one sample per unique endpoint).'
          : 'Raw response samples (internal audience).'
      }</p>
      ${responseCards}
    </div>`
        : ''
    }

    <h2>Observations</h2>
    <div class="panel">${list(observations)}</div>

    <h2>Conclusion &amp; recommendations</h2>
    <div class="panel">
      <p style="margin:0 0 10px"><strong>Verdict:</strong> <span class="${isPass ? 'pass-pill' : 'fail-pill'}">${esc(finalStatus)}</span></p>
      ${list(recommendations)}
    </div>

    <footer>
      ${preparedByName ? `Prepared by: <strong>${esc(preparedByName)}</strong><br/>` : ''}
      JSON: <code>${esc(path.basename(jsonPath))}</code><br/>
      Formal report: <code>${esc(path.basename(formalPath))}</code><br/>
      Raw summary report: <code>${esc(path.basename(htmlPath))}</code>
    </footer>
  </div>
</body>
</html>`;

  const payload = {
    generatedAt,
    title,
    envName,
    scenario,
    baseUrl,
    preparedBy: preparedByName || undefined,
    reportAudience: audience,
    summary: {
      ...summary,
      preparedBy: preparedByName || summary.preparedBy,
      reportAudience: audience,
      coverage: {
        configuredApis,
        enabledApis,
        plannedVus,
        achievedVus,
        uniqueExecutedEndpoints: executedUnique,
        approxRps,
      },
    },
    steps,
    apis: (redactPii ? displayApis : apis).slice(0, 1000),
    failureReasons,
    objective,
    scope,
    loadModel,
    observations,
    recommendations,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(formalPath, html);
  // Keep a short companion summary page for quick open (same content as formal)
  fs.writeFileSync(htmlPath, html);

  // After new run is saved, drop older runs for this suite (keep last 2 by default)
  cleanupOldReports(reportsDir, filePrefix, runsToKeep);

  console.log(`\nTest report: ${formalPath}`);
  console.log(`JSON report: ${jsonPath}`);
  if (open) openReport(formalPath);
  return { jsonPath, htmlPath, formalPath };
}

module.exports = { writeFullTestReport, openReport, cleanupOldReports };
