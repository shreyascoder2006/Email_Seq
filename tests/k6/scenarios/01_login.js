/**
 * tests/k6/scenarios/01_login.js
 *
 * SCENARIO: Login Concurrency Test
 *
 * Purpose:
 *   Verify that the authentication endpoint handles concurrent login requests
 *   without race conditions, token collisions, or rate-limit misfires.
 *
 * Success Criteria:
 *   - p95 response time < 500ms
 *   - Error rate < 1%
 *   - All responses include a valid JWT token
 *   - No 429 rate-limit responses under normal VU load
 *
 * Run:
 *   k6 run tests/k6/scenarios/01_login.js -e BASE_URL=http://localhost:5000
 *   k6 run tests/k6/scenarios/01_login.js -e BASE_URL=http://localhost:5000 -e VUS=50 -e DURATION=60s
 */

import http from 'k6/http';
import { sleep } from 'k6';
import { BASE_URL } from '../lib/auth.js';
import { checkOk } from '../lib/checks.js';
import { check } from 'k6';

// ─── Options ────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    login_ramp: {
      executor:          'ramping-vus',
      startVUs:          0,
      stages: [
        { duration: __ENV.RAMP_UP   || '15s', target: parseInt(__ENV.VUS || '20') },
        { duration: __ENV.DURATION  || '30s', target: parseInt(__ENV.VUS || '20') },
        { duration: __ENV.RAMP_DOWN || '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },

  thresholds: {
    // p95 login must complete in < 500ms
    'http_req_duration{name:auth_login}': ['p(95)<500'],
    // Error rate must be below 1%
    'http_req_failed':                     ['rate<0.01'],
    // Our custom metric: login failures
    'checks':                              ['rate>0.99'],
  },
};

// ─── Test Users Pool ────────────────────────────────────────────────
// Rotate across multiple test accounts to distribute load.
const USERS = [
  { email: __ENV.USER1_EMAIL || 'test1@example.com', password: __ENV.USER1_PASS || 'password123' },
  { email: __ENV.USER2_EMAIL || 'test2@example.com', password: __ENV.USER2_PASS || 'password123' },
  { email: __ENV.USER3_EMAIL || 'test3@example.com', password: __ENV.USER3_PASS || 'password123' },
];

// ─── Default Function ────────────────────────────────────────────────
export default function () {
  // Round-robin user selection per VU
  const user = USERS[(__VU - 1) % USERS.length];

  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: user.email, password: user.password }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags:    { name: 'auth_login' },
    }
  );

  // Assert all expected properties
  check(res, {
    'login: status 200':          (r) => r.status === 200,
    'login: body has token':      (r) => {
      try {
        const b = r.json();
        return !!(b.data?.token || b.token);
      } catch { return false; }
    },
    'login: token is string':     (r) => {
      try {
        const b = r.json();
        const t = b.data?.token || b.token;
        return typeof t === 'string' && t.length > 20;
      } catch { return false; }
    },
    'login: no 401 unauthorized': (r) => r.status !== 401,
    'login: no 500 server error': (r) => r.status < 500,
    'login: response < 500ms':    (r) => r.timings.duration < 500,
  });

  // Simulate realistic user think time (0.5 – 1.5 seconds)
  sleep(Math.random() * 1 + 0.5);
}
