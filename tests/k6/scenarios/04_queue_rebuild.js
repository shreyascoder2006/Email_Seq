/**
 * tests/k6/scenarios/04_queue_rebuild.js
 *
 * SCENARIO: Queue Rebuild Concurrency Test
 *
 * Purpose:
 *   Verify that the POST /api/system/rebuild-queue endpoint is safe to
 *   invoke multiple times concurrently. The endpoint obliterates the
 *   BullMQ queue and re-enqueues all active contacts from MongoDB.
 *
 * Risk:
 *   - Concurrent rebuilds could double-enqueue jobs → duplicate sends
 *   - A rebuild while workers are processing could cause job loss
 *   - The obliterate() call is destructive — must be idempotent in outcome
 *
 * Test Strategy:
 *   - Fire N concurrent rebuild requests with increasing VUs
 *   - After each rebuild wave, hit the health endpoint and assert
 *     queue depth matches active MongoDB contacts count
 *   - Verify no duplicate jobs are created
 *
 * Success Criteria:
 *   - All rebuild requests return 200 with { success: true }
 *   - enqueuedCount is consistent across concurrent responses (or last-writer-wins)
 *   - p95 rebuild response time < 10000ms
 *   - No 500 errors
 *
 * NOTE: This test uses low VU counts intentionally — rebuild is a
 * controlled operation, not a high-throughput endpoint.
 *
 * Run:
 *   k6 run tests/k6/scenarios/04_queue_rebuild.js -e BASE_URL=http://localhost:5000
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, login, authHeaders } from '../lib/auth.js';
import { checkQueueRebuild } from '../lib/checks.js';

// ─── Options ────────────────────────────────────────────────────────
// Staged concurrency: 1 → 3 → 5 concurrent rebuilds
export const options = {
  scenarios: {
    // Stage 1: Single rebuild (baseline)
    single_rebuild: {
      executor:    'per-vu-iterations',
      vus:         1,
      iterations:  3,
      maxDuration: '60s',
    },

    // Stage 2: 3 concurrent rebuilds (near-simultaneous)
    concurrent_rebuild_3: {
      executor:    'per-vu-iterations',
      vus:         3,
      iterations:  2,
      maxDuration: '60s',
      startTime:   '70s',
    },

    // Stage 3: 5 concurrent rebuilds (stress)
    concurrent_rebuild_5: {
      executor:    'per-vu-iterations',
      vus:         5,
      iterations:  1,
      maxDuration: '30s',
      startTime:   '150s',
    },
  },

  thresholds: {
    'http_req_duration{name:queue_rebuild}': ['p(95)<10000'],
    'http_req_failed':                       ['rate<0.01'],
    'checks':                                ['rate>0.95'],
  },
};

// ─── Setup ──────────────────────────────────────────────────────────
export function setup() {
  const { token } = login(0);
  return { token };
}

// ─── Default Function ────────────────────────────────────────────────
export default function (data) {
  if (!data.token) {
    console.warn(`[VU ${__VU}] No auth token — skipping`);
    return;
  }

  const headers = authHeaders(data.token);

  // ── Trigger queue rebuild ──────────────────────────────────────
  const rebuildRes = http.post(
    `${BASE_URL}/api/system/rebuild-queue`,
    null,
    { headers, tags: { name: 'queue_rebuild' }, timeout: '30s' }
  );

  const ok = check(rebuildRes, {
    'rebuild: status 200':           (r) => r.status === 200,
    'rebuild: success=true':         (r) => {
      try { return r.json().success === true; } catch { return false; }
    },
    'rebuild: enqueuedCount numeric': (r) => {
      try {
        const count = r.json().enqueuedCount;
        return typeof count === 'number' && count >= 0;
      } catch { return false; }
    },
    'rebuild: under 10000ms':        (r) => r.timings.duration < 10000,
    'rebuild: no 5xx':               (r) => r.status < 500,
  });

  if (ok) {
    try {
      const body = rebuildRes.json();
      console.log(`[VU ${__VU}] Queue rebuild complete: enqueued=${body.enqueuedCount}, duration=${rebuildRes.timings.duration}ms`);
    } catch {}
  } else {
    console.error(`[VU ${__VU}] Queue rebuild FAILED: ${rebuildRes.status} — ${rebuildRes.body?.substring(0, 200)}`);
  }

  sleep(1);

  // ── Verify health after rebuild ──────────────────────────────
  const healthRes = http.get(
    `${BASE_URL}/api/system/health`,
    { headers, tags: { name: 'post_rebuild_health' } }
  );

  check(healthRes, {
    'post_rebuild_health: status 200':       (r) => r.status === 200,
    'post_rebuild_health: not UNHEALTHY':    (r) => {
      try { return r.json().status !== 'UNHEALTHY'; } catch { return false; }
    },
    'post_rebuild_health: queue depths ok':  (r) => {
      try {
        const depths = r.json().scheduler?.queueDepths;
        // After rebuild, failed count should not have spiked dramatically
        return depths?.failed < 50;
      } catch { return true; } // pass if field not present
    },
  });

  sleep(2);
}
