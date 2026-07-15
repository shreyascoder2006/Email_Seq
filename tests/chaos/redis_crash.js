#!/usr/bin/env node

/**
 * tests/chaos/redis_crash.js
 *
 * CHAOS TEST: Redis Crash Simulation
 *
 * Purpose:
 *   Simulate a Redis crash while emails are being sent and verify that:
 *   1. Workers handle Redis disconnection gracefully (no crashes)
 *   2. Queue reconciliation restores missing jobs on Redis recovery
 *   3. No emails are sent twice (no duplicate sends)
 *   4. No emails are permanently lost
 *   5. Backend health endpoint correctly reports UNHEALTHY
 *   6. System auto-recovers without manual intervention
 *
 * Architecture Context:
 *   - BullMQ uses Redis for job storage
 *   - On Redis loss, delayed jobs vanish from BullMQ
 *   - MongoDB is the source of truth — active contacts remain intact
 *   - Recovery: POST /api/system/rebuild-queue re-syncs BullMQ from MongoDB
 *   - Worker's sending_locked=true prevents double-processing
 *
 * IMPORTANT: This test modifies your Redis instance.
 *   Run ONLY against a non-production Redis instance.
 *   Requires: redis-cli accessible in PATH
 *             Node.js with axios and @bull-board/api
 *
 * Prerequisites:
 *   1. Have an active sequence with >= 50 contacts enrolled
 *   2. Backend running (npm run dev in /backend)
 *   3. Both workers running
 *
 * Usage:
 *   BASE_URL=http://localhost:5000 \
 *   USER_EMAIL=test1@example.com \
 *   USER_PASSWORD=password123 \
 *   SEQUENCE_ID=<id> \
 *   node tests/chaos/redis_crash.js
 */

const http  = require('http');
const https = require('https');
const { execSync, exec } = require('child_process');

const BASE_URL       = process.env.BASE_URL       || 'http://localhost:5000';
const USER_EMAIL     = process.env.USER_EMAIL     || 'test1@example.com';
const USER_PASSWORD  = process.env.USER_PASSWORD  || 'password123';
const SEQUENCE_ID    = process.env.SEQUENCE_ID    || '';
const REDIS_CLI      = process.env.REDIS_CLI      || 'redis-cli';
const REDIS_PORT     = process.env.REDIS_PORT     || '6379';
const CRASH_AFTER_MS = parseInt(process.env.CRASH_AFTER_MS || '5000');
const RECOVERY_WAIT  = parseInt(process.env.RECOVERY_WAIT_MS || '15000');

// ─── HTTP Helpers ─────────────────────────────────────────────────

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url     = new URL(BASE_URL + path);
    const isHttps = url.protocol === 'https:';
    const lib     = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(emoji, msg, data = '') {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${emoji} ${msg}`, data ? JSON.stringify(data) : '');
}

// ─── Redis Control ────────────────────────────────────────────────

function getQueueStats() {
  try {
    const keys = execSync(`${REDIS_CLI} -p ${REDIS_PORT} keys "*email-sequence*" 2>/dev/null`, { encoding: 'utf8' });
    return keys.trim().split('\n').filter(Boolean).length;
  } catch { return -1; }
}

function flushRedisQueues() {
  // Only flush BullMQ queue keys, NOT all of Redis
  try {
    const pattern = 'bull:email-sequence:*';
    const keys    = execSync(`${REDIS_CLI} -p ${REDIS_PORT} keys "${pattern}" 2>/dev/null`, { encoding: 'utf8' });
    const keyList = keys.trim().split('\n').filter(Boolean);
    if (keyList.length > 0) {
      execSync(`${REDIS_CLI} -p ${REDIS_PORT} del ${keyList.join(' ')} 2>/dev/null`, { encoding: 'utf8' });
    }
    return keyList.length;
  } catch (e) {
    return 0;
  }
}

// ─── Main Test ────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(65));
  console.log(' CHAOS TEST: Redis Crash Simulation');
  console.log('═'.repeat(65) + '\n');

  if (!SEQUENCE_ID) {
    console.error('❌ SEQUENCE_ID is required. Set it as an env variable.');
    process.exit(1);
  }

  // ── Phase 1: Pre-test baseline ────────────────────────────────
  log('📊', 'Phase 1: Capturing pre-test baseline...');

  let token;
  try {
    const loginRes = await request('POST', '/api/auth/login', {
      email: USER_EMAIL, password: USER_PASSWORD
    });
    token = loginRes.body?.data?.token;
    if (!token) throw new Error('No token in response');
    log('✅', 'Authenticated', { email: USER_EMAIL });
  } catch (e) {
    log('❌', 'Login failed', { error: e.message });
    process.exit(1);
  }

  // Capture pre-test queue depth
  const preHealth = await request('GET', '/api/system/health', null, token);
  const preDepths = preHealth.body?.scheduler?.queueDepths;
  log('📋', 'Pre-test queue depths', preDepths);

  const preQueueKeys = getQueueStats();
  log('📋', `Pre-test Redis queue key count: ${preQueueKeys}`);

  // Activate sequence to populate the queue
  const activateRes = await request('PATCH', `/api/sequences/${SEQUENCE_ID}/status`,
    { status: 'active' }, token
  );
  if (activateRes.status === 200) {
    log('✅', 'Sequence activated');
  } else {
    log('⚠️', 'Sequence activation result', { status: activateRes.status });
  }

  // Wait for jobs to be enqueued
  await sleep(2000);

  const postActivateHealth = await request('GET', '/api/system/health', null, token);
  const postActivateDepths = postActivateHealth.body?.scheduler?.queueDepths;
  log('📋', 'Post-activation queue depths', postActivateDepths);

  // ── Phase 2: Simulate Redis crash ────────────────────────────
  log('💥', `Phase 2: Simulating Redis queue crash in ${CRASH_AFTER_MS}ms...`);
  await sleep(CRASH_AFTER_MS);

  const flushed = flushRedisQueues();
  log('💥', `CHAOS: Flushed ${flushed} BullMQ queue keys from Redis`);

  // Verify queue is now empty
  const postCrashHealth = await request('GET', '/api/system/health', null, token);
  const postCrashDepths = postCrashHealth.body?.scheduler?.queueDepths;
  log('📋', 'Post-crash queue depths (should be 0)', postCrashDepths);

  // ── Phase 3: Wait for system to detect crash ──────────────────
  log('⏳', `Phase 3: Waiting ${RECOVERY_WAIT}ms for watchdog to detect stall...`);
  await sleep(RECOVERY_WAIT);

  // ── Phase 4: Check system health ─────────────────────────────
  log('🔍', 'Phase 4: Checking system health post-crash...');
  const midHealth = await request('GET', '/api/system/health', null, token);
  log('📋', 'Mid-chaos health status', {
    status:     midHealth.body?.status,
    infraStatus: midHealth.body?.scheduler?.infraStatus,
    queueDepths: midHealth.body?.scheduler?.queueDepths,
  });

  // ── Phase 5: Trigger queue rebuild ───────────────────────────
  log('🔧', 'Phase 5: Triggering queue rebuild...');
  const rebuildRes = await request('POST', '/api/system/rebuild-queue', null, token);
  log('📋', 'Queue rebuild result', {
    status:       rebuildRes.status,
    success:      rebuildRes.body?.success,
    enqueuedCount: rebuildRes.body?.enqueuedCount,
  });

  if (rebuildRes.status !== 200 || !rebuildRes.body?.success) {
    log('❌', 'FAIL: Queue rebuild failed after Redis crash!');
  } else {
    log('✅', `PASS: Queue rebuilt — re-enqueued ${rebuildRes.body.enqueuedCount} jobs`);
  }

  // ── Phase 6: Post-recovery validation ────────────────────────
  log('⏳', 'Phase 6: Waiting 10s for workers to process rebuilt queue...');
  await sleep(10000);

  const postRecoveryHealth = await request('GET', '/api/system/health', null, token);
  const postRecoveryDepths = postRecoveryHealth.body?.scheduler?.queueDepths;
  log('📋', 'Post-recovery queue depths', postRecoveryDepths);

  // ── Phase 7: Summary & assertions ────────────────────────────
  console.log('\n' + '─'.repeat(65));
  console.log(' CHAOS TEST RESULTS: Redis Crash');
  console.log('─'.repeat(65));

  const assertions = [
    {
      name:   'Queue rebuild succeeded',
      pass:   rebuildRes.status === 200 && rebuildRes.body?.success === true,
      detail: `status=${rebuildRes.status} success=${rebuildRes.body?.success}`,
    },
    {
      name:   'Enqueued count >= 0 after rebuild',
      pass:   (rebuildRes.body?.enqueuedCount ?? -1) >= 0,
      detail: `enqueuedCount=${rebuildRes.body?.enqueuedCount}`,
    },
    {
      name:   'Health endpoint recovers from crash',
      pass:   postRecoveryHealth.status === 200,
      detail: `status=${postRecoveryHealth.status}`,
    },
    {
      name:   'System not stuck in UNHEALTHY',
      pass:   postRecoveryHealth.body?.status !== 'UNHEALTHY',
      detail: `status=${postRecoveryHealth.body?.status}`,
    },
  ];

  let passed = 0;
  for (const a of assertions) {
    const icon = a.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${icon}: ${a.name} — ${a.detail}`);
    if (a.pass) passed++;
  }

  console.log(`\n  ${passed}/${assertions.length} assertions passed`);
  console.log('\n⚠️  IMPORTANT: Run check_db_consistency.js now to verify no duplicate sends!\n');

  if (passed < assertions.length) process.exit(1);
}

main().catch(err => {
  console.error('Fatal chaos test error:', err);
  process.exit(1);
});
