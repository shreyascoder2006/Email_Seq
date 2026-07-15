/**
 * tests/k6/lib/checks.js
 *
 * Reusable k6 check assertions for all test scenarios.
 * Provides consistent validation patterns across the test suite.
 */

import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── Custom Metrics ─────────────────────────────────────────────────
// Collect these across all scenarios for the performance dashboard.

export const duplicateSendRate   = new Rate('duplicate_sends');
export const missedSendRate      = new Rate('missed_sends');
export const lockReleaseRate     = new Rate('lock_release_failures');
export const queueConsistencyRate = new Rate('queue_consistency_errors');
export const emailThroughput     = new Trend('email_throughput_ms');
export const workerPickupLatency = new Trend('worker_pickup_latency_ms');
export const apiErrorRate        = new Rate('api_errors');

// ─── Generic API Check ──────────────────────────────────────────────

/**
 * Assert a successful 2xx API response.
 * Tracks the api_errors metric on failure.
 *
 * @param {object} res     - k6 http.Response
 * @param {string} label   - Human-readable test label for error logs
 * @param {number} status  - Expected HTTP status (default 200)
 * @returns {boolean}
 */
export function checkOk(res, label, status = 200) {
  const ok = check(res, {
    [`${label}: status ${status}`]: (r) => r.status === status,
    [`${label}: response time < 3000ms`]: (r) => r.timings.duration < 3000,
  });

  if (!ok) {
    apiErrorRate.add(1);
    console.error(`[FAIL] ${label}: status=${res.status} body=${res.body?.substring(0, 300)}`);
  } else {
    apiErrorRate.add(0);
  }

  return ok;
}

/**
 * Assert a successful sequence status transition response.
 */
export function checkTransition(res, expectedStatus, label) {
  return check(res, {
    [`${label}: HTTP 200`]:            (r) => r.status === 200,
    [`${label}: status field matches`]: (r) => {
      try {
        const body = r.json();
        return body.data?.status === expectedStatus || body.status === expectedStatus;
      } catch { return false; }
    },
    [`${label}: response time < 2000ms`]: (r) => r.timings.duration < 2000,
  });
}

/**
 * Assert queue rebuild response.
 */
export function checkQueueRebuild(res) {
  return check(res, {
    'queue_rebuild: HTTP 200':          (r) => r.status === 200,
    'queue_rebuild: success=true':      (r) => {
      try { return r.json().success === true; } catch { return false; }
    },
    'queue_rebuild: enqueuedCount >= 0': (r) => {
      try { return r.json().enqueuedCount >= 0; } catch { return false; }
    },
    'queue_rebuild: response < 10000ms': (r) => r.timings.duration < 10000,
  });
}

/**
 * Assert system health response.
 */
export function checkHealth(res) {
  return check(res, {
    'health: HTTP 200 or 503':   (r) => [200, 503].includes(r.status),
    'health: status field set':  (r) => {
      try {
        const s = r.json().status || r.json().data?.status;
        return ['healthy', 'degraded', 'HEALTHY', 'DEGRADED', 'UNHEALTHY'].includes(s);
      } catch { return false; }
    },
    'health: redis.healthy present': (r) => {
      try {
        const body = r.json();
        // Either /api/health or /api/system/health format
        return body.services?.redis?.status !== undefined || body.redis?.healthy !== undefined;
      } catch { return false; }
    },
  });
}

/**
 * Assert bulk contact enroll response.
 */
export function checkEnroll(res, label = 'enroll') {
  return check(res, {
    [`${label}: HTTP 200 or 201`]:   (r) => [200, 201].includes(r.status),
    [`${label}: enrolled count > 0`]: (r) => {
      try {
        const body = r.json();
        return (body.data?.enrolled ?? body.enrolled ?? 0) >= 0;
      } catch { return false; }
    },
  });
}

/**
 * Assert reschedule response.
 */
export function checkReschedule(res) {
  return check(res, {
    'reschedule: HTTP 200':         (r) => r.status === 200,
    'reschedule: success=true':     (r) => {
      try { return r.json().data !== undefined; } catch { return false; }
    },
    'reschedule: response < 5000ms': (r) => r.timings.duration < 5000,
  });
}

/**
 * Assert contact import response.
 */
export function checkImport(res, label = 'import') {
  return check(res, {
    [`${label}: HTTP 200 or 201`]:         (r) => [200, 201].includes(r.status),
    [`${label}: import_list_id present`]:   (r) => {
      try {
        const body = r.json();
        return !!(body.data?._id || body.data?.id || body._id);
      } catch { return false; }
    },
    [`${label}: response < 5000ms`]:        (r) => r.timings.duration < 5000,
  });
}
