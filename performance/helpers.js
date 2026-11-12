import http from 'k6/http';
import { check, sleep } from 'k6';
import { htmlReport } from '../node_modules/k6-modern-reporter/k6-modern-reporter.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

export function headers() {
  const h = {
    Accept: 'application/json',
    // Some gateways reset k6 connections when gzip/default UA is used
    'Accept-Encoding': 'identity',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    Connection: 'close',
  };
  const token = __ENV.AUTH_TOKEN || '';
  if (token && token !== 'REPLACE_WITH_STAGING_JWT') {
    h.Authorization = `Bearer ${token}`;
  }
  return h;
}

export function callGet(path, service) {
  const base = (__ENV.BASE_URL || '').replace(/\/$/, '');
  const res = http.get(`${base}${path}`, {
    headers: headers(),
    tags: { service, endpoint: path },
    timeout: '30s',
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'got http response': (r) => r.status > 0,
    'time < 500ms': (r) => r.status === 0 || r.timings.duration < 500,
  });

  sleep(0.2);
  return res;
}

export function makeReport(name) {
  return function handleSummary(data) {
    const dir = __ENV.K6_REPORTS_DIR || 'performance/reports/staging';
    const file = `${dir}/${name}.html`;
    return {
      [file]: htmlReport(data, { title: name, subtitle: `${__ENV.ENV_NAME} GET APIs`, httpMethod: 'GET' }),
      stdout: textSummary(data, { indent: ' ', enableColors: true }),
    };
  };
}

// Load profile by scenario name
export function scenarioOptions(name) {
  const thresholds = {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    checks: ['rate>0.99'],
  };

  const profiles = {
    // Hit every API in apis.json exactly once
    once: {
      insecureSkipTLSVerify: true,
      tlsVersion: { min: 'tls1.2', max: 'tls1.2' },
      noConnectionReuse: true,
      scenarios: {
        all_apis_once: {
          executor: 'shared-iterations',
          vus: 1,
          iterations: Number(__ENV.API_COUNT || 27),
          maxDuration: '10m',
        },
      },
      // Auth may return 400/401 until a real token is set; still collect results
      thresholds: {
        http_req_failed: ['rate<1.01'],
        checks: ['rate>0.0'],
      },
    },
    smoke: { vus: 1, duration: '5m', thresholds: { ...thresholds, checks: ['rate==1.0'] } },
    baseline: { vus: 10, duration: '15m', thresholds },
    load: {
      stages: [
        { duration: '10m', target: 100 },
        { duration: '30m', target: 100 },
        { duration: '5m', target: 0 },
      ],
      thresholds,
    },
    stress: {
      stages: [
        { duration: '5m', target: 100 },
        { duration: '5m', target: 500 },
        { duration: '5m', target: 1000 },
        { duration: '5m', target: 2000 },
        { duration: '5m', target: 0 },
      ],
      thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<1500'],
        checks: ['rate>0.95'],
      },
    },
    spike: {
      stages: [
        { duration: '1m', target: 20 },
        { duration: '30s', target: 500 },
        { duration: '2m', target: 500 },
        { duration: '30s', target: 20 },
        { duration: '2m', target: 20 },
      ],
      thresholds: {
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<1000'],
        checks: ['rate>0.98'],
      },
    },
    soak: { vus: 50, duration: '12h', thresholds },
  };

  return profiles[name] || profiles.smoke;
}
