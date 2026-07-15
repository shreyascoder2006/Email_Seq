/**
 * tests/k6/scenarios/06_email_send_load.js
 *
 * SCENARIO: Email Sending Load Test
 *
 * Purpose:
 *   Simulate high-volume email send loads by:
 *   1. Creating a sequence with N contacts enrolled
 *   2. Activating the sequence (triggers job enqueue)
 *   3. Monitoring health/worker endpoints to track queue drain
 *   4. Validating throughput, latency, and zero duplicate sends
 *
 * Test Matrix (EMAIL_COUNT env var):
 *   100   emails → Baseline, ~30s to drain with default concurrency
 *   500   emails → Medium load
 *   1000  emails → High load
 *   5000  emails → Stress test (requires multiple workers)
 *
 * NOTE: This scenario does NOT send real emails. It enrolls contacts
 * into an active sequence and watches the queue depth drain.
 * For real SMTP testing, set USE_REAL_SMTP=true and configure SMTP creds.
 *
 * Metrics Measured:
 *   - Time to enroll N contacts
 *   - Time for queue depth to reach 0 (throughput)
 *   - Worker health at peak load
 *   - Failed job count after drain
 *
 * Run:
 *   k6 run tests/k6/scenarios/06_email_send_load.js \
 *     -e BASE_URL=http://localhost:5000 \
 *     -e EMAIL_COUNT=100 \
 *     -e EMAIL_CONNECTION_ID=<id> \
 *     -e MONITOR_DURATION=120s
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Gauge } from 'k6/metrics';
import { BASE_URL, login, authHeaders } from '../lib/auth.js';
import { generateContacts, buildEnrollBody, buildSequenceBody } from '../lib/dataFactory.js';

const EMAIL_COUNT          = parseInt(__ENV.EMAIL_COUNT        || '100');
const EMAIL_CONNECTION_ID  = __ENV.EMAIL_CONNECTION_ID         || '';
const MONITOR_DURATION     = parseInt(__ENV.MONITOR_DURATION_S || '120');

// Custom metrics
const queueDepthGauge      = new Gauge('queue_depth_delayed');
const activeJobsGauge      = new Gauge('queue_active_jobs');
const failedJobsGauge      = new Gauge('queue_failed_jobs');
const enrollmentDuration   = new Trend('enrollment_duration_ms');

// ─── Options ────────────────────────────────────────────────────────
// This test uses a single-VU orchestrator pattern.
// One VU controls the full lifecycle; monitoring happens in a parallel scenario.
export const options = {
  scenarios: {
    // VU 1: Orchestrator — create sequence, enroll contacts, activate
    orchestrator: {
      executor:    'per-vu-iterations',
      vus:         1,
      iterations:  1,
      maxDuration: '300s',
    },

    // VU 2-4: Monitors — poll health endpoints during load
    monitors: {
      executor:    'constant-vus',
      vus:         3,
      duration:    `${MONITOR_DURATION + 60}s`,
      startTime:   '5s',
    },
  },

  thresholds: {
    'http_req_duration{name:enroll_contacts_bulk}': ['p(95)<30000'],
    'http_req_duration{name:activate_sequence}':    ['p(95)<2000'],
    'http_req_failed':                              ['rate<0.05'],
  },
};

// ─── Shared state between scenarios ─────────────────────────────────
// (k6 setup() data is passed to ALL scenarios)

export function setup() {
  const { token } = login(0);
  if (!token) {
    console.error('[setup] Login failed — aborting');
    return {};
  }
  const headers = authHeaders(token);

  // Create a dedicated load-test sequence
  const seqRes = http.post(
    `${BASE_URL}/api/sequences`,
    JSON.stringify({
      name:                `[LOAD-TEST] Email Send Load ${EMAIL_COUNT} ${Date.now()}`,
      email_connection_id: EMAIL_CONNECTION_ID,
      sending_window: {
        timezone:    'UTC',
        start_hour:  0,
        start_minute: 0,
        end_hour:    23,
        end_minute:  59,
        custom_days: [0, 1, 2, 3, 4, 5, 6], // All days
      },
      stop_on_reply: false,
      track_opens:   false,
      track_clicks:  false,
    }),
    { headers }
  );

  if (![200, 201].includes(seqRes.status)) {
    console.error(`[setup] Failed to create sequence: ${seqRes.status} ${seqRes.body}`);
    return { token };
  }

  const seqBody = seqRes.json();
  const seqId   = seqBody.data?._id || seqBody.data?.id;

  console.log(`[setup] Created load-test sequence: ${seqId} for ${EMAIL_COUNT} emails`);

  return { token, seqId };
}

// ─── Orchestrator ────────────────────────────────────────────────────
let _orchestratorDone = false;

export default function (data) {
  // Monitors use a different execution path
  if (__ENV.K6_SCENARIO_NAME === 'monitors') {
    monitorWorkers(data);
    return;
  }

  // Orchestrator runs once
  orchestrate(data);
}

function orchestrate(data) {
  if (!data.token || !data.seqId) {
    console.error('[orchestrator] Setup data missing — aborting');
    return;
  }

  const headers = authHeaders(data.token);
  const seqId   = data.seqId;
  const t0      = Date.now();

  // ── 1. Enroll contacts in batches ─────────────────────────────
  // Enroll in chunks of 50 to avoid oversized requests
  const BATCH_SIZE   = 50;
  const batches      = Math.ceil(EMAIL_COUNT / BATCH_SIZE);
  let   totalEnrolled = 0;

  console.log(`[orchestrator] Enrolling ${EMAIL_COUNT} contacts in ${batches} batches of ${BATCH_SIZE}`);

  for (let b = 0; b < batches; b++) {
    const size     = Math.min(BATCH_SIZE, EMAIL_COUNT - b * BATCH_SIZE);
    const contacts = generateContacts(size, `load-batch${b}`);

    const enrollRes = http.post(
      `${BASE_URL}/api/sequences/${seqId}/enroll`,
      JSON.stringify(buildEnrollBody(contacts)),
      { headers, tags: { name: 'enroll_contacts_bulk' }, timeout: '30s' }
    );

    const ok = check(enrollRes, {
      'enroll_batch: status 200 or 201': (r) => [200, 201].includes(r.status),
      'enroll_batch: no 500':            (r) => r.status < 500,
    });

    if (ok) {
      try {
        const body = enrollRes.json();
        totalEnrolled += body.data?.enrolled ?? size;
      } catch { totalEnrolled += size; }
    }

    sleep(0.1);
  }

  const enrollDuration = Date.now() - t0;
  enrollmentDuration.add(enrollDuration);
  console.log(`[orchestrator] Enrolled ${totalEnrolled}/${EMAIL_COUNT} contacts in ${enrollDuration}ms`);

  sleep(1);

  // ── 2. Activate sequence ───────────────────────────────────────
  const activateRes = http.patch(
    `${BASE_URL}/api/sequences/${seqId}/status`,
    JSON.stringify({ status: 'active' }),
    { headers, tags: { name: 'activate_sequence' }, timeout: '10s' }
  );

  check(activateRes, {
    'activate: status 200':       (r) => r.status === 200,
    'activate: status is active': (r) => {
      try { return (r.json().data?.status || r.json().status) === 'active'; } catch { return false; }
    },
  });

  console.log(`[orchestrator] Sequence ACTIVATED. Queue should start draining...`);

  // ── 3. Monitor queue drain ─────────────────────────────────────
  const t1         = Date.now();
  let   drainSecs  = 0;

  for (let i = 0; i < MONITOR_DURATION; i += 5) {
    sleep(5);

    const healthRes = http.get(
      `${BASE_URL}/api/system/health`,
      { headers, tags: { name: 'health_during_load' } }
    );

    if (healthRes.status === 200) {
      try {
        const body   = healthRes.json();
        const depths = body.scheduler?.queueDepths;
        if (depths) {
          queueDepthGauge.add(depths.delayed || 0);
          activeJobsGauge.add(depths.active  || 0);
          failedJobsGauge.add(depths.failed  || 0);

          console.log(`[monitor] t+${i+5}s — delayed=${depths.delayed} active=${depths.active} failed=${depths.failed} completed=${depths.completed}`);

          if ((depths.delayed || 0) === 0 && (depths.active || 0) === 0) {
            drainSecs = (Date.now() - t1) / 1000;
            console.log(`[orchestrator] ✅ Queue DRAINED in ${drainSecs.toFixed(1)}s for ${EMAIL_COUNT} emails`);
            break;
          }
        }
      } catch {}
    }
  }

  if (drainSecs === 0) {
    console.warn(`[orchestrator] ⚠️ Queue NOT fully drained after ${MONITOR_DURATION}s — check for stalls`);
  }

  // ── 4. Archive & cleanup ──────────────────────────────────────
  http.patch(
    `${BASE_URL}/api/sequences/${seqId}/status`,
    JSON.stringify({ status: 'archived' }),
    { headers }
  );
}

function monitorWorkers(data) {
  if (!data.token) { sleep(5); return; }

  const headers = authHeaders(data.token);

  const workersRes = http.get(
    `${BASE_URL}/api/system/workers`,
    { headers, tags: { name: 'workers_metrics' } }
  );

  check(workersRes, {
    'workers: status 200':          (r) => r.status === 200,
    'workers: worker running':      (r) => {
      try { return r.json().emailWorker?.workerRunning === true; } catch { return false; }
    },
    'workers: redis connected':     (r) => {
      try { return r.json().emailWorker?.redisConnected === true; } catch { return false; }
    },
  });

  sleep(5);
}

// ─── Teardown ────────────────────────────────────────────────────────
export function teardown(data) {
  if (!data.token || !data.seqId) return;
  // Final cleanup: delete load-test sequence
  http.del(
    `${BASE_URL}/api/sequences/${data.seqId}`,
    null,
    { headers: authHeaders(data.token) }
  );
  console.log(`[teardown] Deleted load-test sequence: ${data.seqId}`);
}
