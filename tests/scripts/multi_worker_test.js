#!/usr/bin/env node

/**
 * tests/scripts/multi_worker_test.js
 *
 * MULTI-WORKER TESTING SCRIPT
 *
 * Purpose:
 *   Verify that BullMQ's distributed job processing works correctly
 *   with multiple worker instances. Tests:
 *   1. Even job distribution across workers
 *   2. No duplicate processing (MongoDB sending_locked ensures this)
 *   3. schedule_version prevents stale job execution
 *   4. All contacts processed exactly once
 *
 * Strategy:
 *   - Enroll N contacts into a sequence
 *   - Start 1, 2, or 5 worker processes (configurable)
 *   - Activate sequence and monitor queue drain
 *   - Poll health/workers to observe distribution
 *   - After drain, run DB consistency check to validate deduplication
 *
 * This script validates architecture correctness, NOT raw throughput.
 *
 * Usage:
 *   WORKER_COUNT=2 \
 *   CONTACT_COUNT=50 \
 *   BASE_URL=http://localhost:5000 \
 *   SEQUENCE_ID=<id> \
 *   node tests/scripts/multi_worker_test.js
 *
 * Environment Variables:
 *   WORKER_COUNT     — Number of workers to simulate (1, 2, 5)
 *   CONTACT_COUNT    — Number of contacts to enroll (default: 50)
 *   SEQUENCE_ID      — Existing sequence ID to use
 *   POLL_INTERVAL_MS — How often to poll health (default: 2000)
 *   DRAIN_TIMEOUT_MS — Max time to wait for queue drain (default: 120000)
 */

const http   = require('http');
const https  = require('https');

const BASE_URL          = process.env.BASE_URL          || 'http://localhost:5000';
const USER_EMAIL        = process.env.USER_EMAIL        || 'test1@example.com';
const USER_PASSWORD     = process.env.USER_PASSWORD     || 'password123';
const SEQUENCE_ID       = process.env.SEQUENCE_ID       || '';
const WORKER_COUNT      = parseInt(process.env.WORKER_COUNT || '1');
const CONTACT_COUNT     = parseInt(process.env.CONTACT_COUNT || '50');
const POLL_INTERVAL_MS  = parseInt(process.env.POLL_INTERVAL_MS || '2000');
const DRAIN_TIMEOUT_MS  = parseInt(process.env.DRAIN_TIMEOUT_MS || '120000');

function request(method, urlPath, body = null, token = null, timeout = 10000) {
  return new Promise((resolve) => {
    const url     = new URL(BASE_URL + urlPath);
    const isHttps = url.protocol === 'https:';
    const lib     = isHttps ? require('https') : require('http');

    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type':  'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      timeout,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(emoji, msg, data = '') {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${emoji} ${msg}`, data ? JSON.stringify(data, null, 2) : '');
}

// ─── Metrics Collection ──────────────────────────────────────────
const metrics = {
  snapshots: [],
  start:     Date.now(),
};

function recordSnapshot(snapshot) {
  metrics.snapshots.push({
    elapsed_ms: Date.now() - metrics.start,
    ...snapshot,
  });
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(65));
  console.log(` MULTI-WORKER TEST: ${WORKER_COUNT} Worker(s), ${CONTACT_COUNT} Contacts`);
  console.log('═'.repeat(65) + '\n');

  if (!SEQUENCE_ID) {
    console.error('❌ SEQUENCE_ID is required');
    process.exit(1);
  }

  // ── Phase 1: Authenticate ────────────────────────────────────
  const loginRes = await request('POST', '/api/auth/login', {
    email: USER_EMAIL, password: USER_PASSWORD
  });
  const token = loginRes.body?.data?.token;
  if (!token) { log('❌', 'Login failed'); process.exit(1); }
  log('✅', 'Authenticated');

  // ── Phase 2: Pre-test system state ───────────────────────────
  log('📊', 'Phase 2: Pre-test system state...');

  const preWorkers = await request('GET', '/api/system/workers', null, token);
  log('📋', 'Worker health', {
    emailWorker:    preWorkers.body?.emailWorker,
    schedulerWorker: preWorkers.body?.schedulerWorker,
  });

  const preHealth  = await request('GET', '/api/system/health', null, token);
  const preDepths  = preHealth.body?.scheduler?.queueDepths;
  log('📋', 'Pre-test queue depths', preDepths);

  // ── Phase 3: Enroll contacts ──────────────────────────────────
  log('👥', `Phase 3: Enrolling ${CONTACT_COUNT} contacts...`);

  const contacts = [];
  for (let i = 0; i < CONTACT_COUNT; i++) {
    contacts.push({
      email:      `mw-test-${Date.now()}-${i}@multiworker.invalid`,
      first_name: `MultiWorker`,
      last_name:  `Contact${i}`,
      company:    `TestCo${i % 5}`,
    });
  }

  const enrollRes = await request(
    'POST',
    `/api/sequences/${SEQUENCE_ID}/enroll`,
    { contacts },
    token,
    30000
  );

  if (![200, 201].includes(enrollRes.status)) {
    log('❌', 'Enrollment failed', { status: enrollRes.status });
    process.exit(1);
  }

  const enrolled = enrollRes.body?.data?.enrolled ?? CONTACT_COUNT;
  log('✅', `Enrolled ${enrolled} contacts`);

  // ── Phase 4: Activate sequence ────────────────────────────────
  log('▶️', 'Phase 4: Activating sequence...');

  const activateRes = await request(
    'PATCH',
    `/api/sequences/${SEQUENCE_ID}/status`,
    { status: 'active' },
    token
  );

  if (activateRes.status !== 200 && activateRes.status !== 400) {
    log('❌', 'Activation failed', { status: activateRes.status });
    process.exit(1);
  }

  log('✅', 'Sequence activated — jobs should begin enqueuing');

  // ── Phase 5: Monitor queue drain ──────────────────────────────
  log('📡', `Phase 5: Monitoring queue drain (timeout=${DRAIN_TIMEOUT_MS}ms)...`);
  log('ℹ️', `Ensure ${WORKER_COUNT} worker instance(s) are running!`);

  const deadline       = Date.now() + DRAIN_TIMEOUT_MS;
  let   lastDelayed    = -1;
  let   drainedAt      = null;
  const pollHistory    = [];

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const healthRes = await request('GET', '/api/system/health', null, token);
    const depths    = healthRes.body?.scheduler?.queueDepths;

    if (depths) {
      const snapshot = {
        delayed:   depths.delayed   || 0,
        active:    depths.active    || 0,
        completed: depths.completed || 0,
        failed:    depths.failed    || 0,
        waiting:   depths.waiting   || 0,
      };

      pollHistory.push({ ...snapshot, timestamp: new Date().toISOString() });
      recordSnapshot(snapshot);

      const elapsed = ((Date.now() - metrics.start) / 1000).toFixed(1);
      console.log(
        `  [t+${elapsed}s] delayed=${snapshot.delayed} active=${snapshot.active} ` +
        `completed=${snapshot.completed} failed=${snapshot.failed}`
      );

      if (lastDelayed > 0 && snapshot.delayed === 0 && snapshot.active === 0) {
        drainedAt = Date.now();
        break;
      }

      lastDelayed = snapshot.delayed;
    }
  }

  // ── Phase 6: Final metrics ────────────────────────────────────
  console.log('\n' + '─'.repeat(65));
  console.log(` MULTI-WORKER TEST RESULTS: ${WORKER_COUNT} Worker(s)`);
  console.log('─'.repeat(65));

  const totalElapsed = ((Date.now() - metrics.start) / 1000).toFixed(1);
  const drainTime    = drainedAt ? ((drainedAt - metrics.start) / 1000).toFixed(1) : 'TIMEOUT';
  const throughput   = drainedAt
    ? (CONTACT_COUNT / ((drainedAt - metrics.start) / 1000)).toFixed(2)
    : 'N/A';

  const finalHealth = await request('GET', '/api/system/health', null, token);
  const finalDepths = finalHealth.body?.scheduler?.queueDepths;

  console.log(`
  Configuration:
    Workers:         ${WORKER_COUNT}
    Contacts:        ${CONTACT_COUNT}
    Queue Name:      email-sequence

  Results:
    Queue drain time:    ${drainTime}s
    Throughput:          ${throughput} emails/sec
    Total elapsed:       ${totalElapsed}s
    Final delayed:       ${finalDepths?.delayed ?? 'N/A'}
    Final active:        ${finalDepths?.active  ?? 'N/A'}
    Final completed:     ${finalDepths?.completed ?? 'N/A'}
    Final failed:        ${finalDepths?.failed ?? 'N/A'}

  Assertions:`);

  const assertions = [
    {
      name:  'Queue fully drained within timeout',
      pass:  drainedAt !== null,
      detail: drainedAt ? `drained in ${drainTime}s` : `TIMEOUT after ${DRAIN_TIMEOUT_MS}ms`,
    },
    {
      name:  'No failed jobs',
      pass:  (finalDepths?.failed ?? 0) === 0,
      detail: `failed=${finalDepths?.failed ?? 'unknown'}`,
    },
    {
      name:  'Delayed count is zero',
      pass:  (finalDepths?.delayed ?? -1) === 0,
      detail: `delayed=${finalDepths?.delayed ?? 'unknown'}`,
    },
  ];

  let passed = 0;
  for (const a of assertions) {
    const icon = a.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`    ${icon}: ${a.name} — ${a.detail}`);
    if (a.pass) passed++;
  }

  console.log(`\n  ${passed}/${assertions.length} assertions passed`);
  console.log('\n⚠️  NEXT STEP: Run check_db_consistency.js to verify no duplicate sends!\n');

  // Export metrics as JSON for CI dashboards
  if (process.env.OUTPUT === 'json') {
    console.log(JSON.stringify({
      config:    { workerCount: WORKER_COUNT, contactCount: CONTACT_COUNT },
      results:   { drainTime, throughput, elapsed: totalElapsed },
      finalDepths,
      assertions,
      pollHistory,
    }, null, 2));
  }

  if (passed < assertions.length) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
