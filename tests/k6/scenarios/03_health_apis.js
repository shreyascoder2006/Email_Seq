/**
 * tests/k6/scenarios/03_health_apis.js
 *
 * SCENARIO: Health & System API Concurrency Test
 *
 * Purpose:
 *   Verify that the health and system monitoring endpoints remain
 *   responsive and correct under concurrent polling load.
 *   Health endpoints must NEVER be a bottleneck — they are used by
 *   load balancers, monitoring agents, and operations dashboards.
 *
 * Endpoints tested:
 *   GET  /api/health          — Public queue health (no auth)
 *   GET  /api/health/ping     — Ultra-lightweight liveness probe (no auth)
 *   GET  /api/system/health   — Detailed system health (JWT required)
 *   GET  /api/system/workers  — Worker queue metrics (JWT required)
 *
 * Success Criteria:
 *   - /api/health/ping p99 < 50ms  (liveness probe must be instant)
 *   - /api/health       p95 < 200ms
 *   - /api/system/health p95 < 1000ms (includes Redis+MongoDB ping)
 *   - No 5xx errors on any health endpoint
 *   - Status field is always present in response body
 *
 * Run:
 *   k6 run tests/k6/scenarios/03_health_apis.js -e BASE_URL=http://localhost:5000
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, login, authHeaders } from '../lib/auth.js';
import { checkHealth } from '../lib/checks.js';

const VUS      = parseInt(__ENV.VUS     || '30');
const DURATION = __ENV.DURATION         || '60s';

// ─── Options ────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    health_polling: {
      executor:  'constant-vus',
      vus:       VUS,
      duration:  DURATION,
    },
  },
  thresholds: {
    // Liveness probe must be instant
    'http_req_duration{name:health_ping}':       ['p(99)<50'],
    // Basic health check
    'http_req_duration{name:health_basic}':      ['p(95)<200'],
    // Detailed system health (includes Redis+Mongo pings)
    'http_req_duration{name:system_health}':     ['p(95)<1000'],
    // Worker metrics
    'http_req_duration{name:system_workers}':    ['p(95)<1500'],
    // No server errors
    'http_req_failed':                           ['rate<0.001'],
    'checks':                                    ['rate>0.999'],
  },
};

// ─── Setup ──────────────────────────────────────────────────────────
export function setup() {
  const { token } = login(0);
  return { token };
}

// ─── Default Function ────────────────────────────────────────────────
export default function (data) {
  const headers = data.token ? authHeaders(data.token) : { 'Content-Type': 'application/json' };

  // ── 1. Liveness ping (no auth needed) ──────────────────────────
  const pingRes = http.get(
    `${BASE_URL}/api/health/ping`,
    { tags: { name: 'health_ping' } }
  );

  check(pingRes, {
    'ping: status 200':       (r) => r.status === 200,
    'ping: pong field true':  (r) => {
      try { return r.json().pong === true; } catch { return false; }
    },
    'ping: under 50ms':       (r) => r.timings.duration < 50,
  });

  sleep(0.1);

  // ── 2. Basic health (no auth needed) ───────────────────────────
  const healthRes = http.get(
    `${BASE_URL}/api/health`,
    { tags: { name: 'health_basic' } }
  );

  check(healthRes, {
    'health: status 200 or 503':      (r) => [200, 503].includes(r.status),
    'health: status field present':   (r) => {
      try { return !!r.json().data?.status; } catch { return false; }
    },
    'health: services object exists': (r) => {
      try { return !!r.json().data?.services; } catch { return false; }
    },
    'health: mongodb status present': (r) => {
      try { return !!r.json().data?.services?.mongodb?.status; } catch { return false; }
    },
    'health: redis status present':   (r) => {
      try { return !!r.json().data?.services?.redis?.status; } catch { return false; }
    },
    'health: under 200ms':            (r) => r.timings.duration < 200,
  });

  sleep(0.2);

  // ── 3. System health (JWT required) ─────────────────────────────
  if (data.token) {
    const sysHealthRes = http.get(
      `${BASE_URL}/api/system/health`,
      { headers, tags: { name: 'system_health' } }
    );

    check(sysHealthRes, {
      'system_health: status 200':          (r) => r.status === 200,
      'system_health: overallStatus set':   (r) => {
        try {
          const s = r.json().status;
          return ['HEALTHY', 'DEGRADED', 'UNHEALTHY'].includes(s);
        } catch { return false; }
      },
      'system_health: redis field present': (r) => {
        try { return r.json().redis !== undefined; } catch { return false; }
      },
      'system_health: scheduler field':     (r) => {
        try { return r.json().scheduler !== undefined; } catch { return false; }
      },
      'system_health: under 1000ms':        (r) => r.timings.duration < 1000,
    });

    sleep(0.3);

    // ── 4. Worker metrics (JWT required) ─────────────────────────
    const workersRes = http.get(
      `${BASE_URL}/api/system/workers`,
      { headers, tags: { name: 'system_workers' } }
    );

    check(workersRes, {
      'workers: status 200':               (r) => r.status === 200,
      'workers: schedulerWorker field':    (r) => {
        try { return r.json().schedulerWorker !== undefined; } catch { return false; }
      },
      'workers: emailWorker field':        (r) => {
        try { return r.json().emailWorker !== undefined; } catch { return false; }
      },
      'workers: under 1500ms':             (r) => r.timings.duration < 1500,
    });
  }

  sleep(0.5 + Math.random() * 0.5);
}
