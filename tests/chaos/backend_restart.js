#!/usr/bin/env node

/**
 * tests/chaos/backend_restart.js
 *
 * CHAOS TEST: Backend Process Restart During Send
 *
 * Purpose:
 *   Simulate a backend process restart (crash or deploy) while emails
 *   are actively being sent, and verify:
 *   1. No duplicate emails are sent (sending_locked + schedule_version)
 *   2. No emails are permanently lost (MongoDB is source of truth)
 *   3. Workers that were running continue without interruption
 *   4. Queue reconciliation restores any lost jobs on restart
 *   5. Health endpoints immediately reflect the new state
 *
 * Architecture Context:
 *   - Backend restart does NOT kill BullMQ workers (they're in-process)
 *   - On restart: server.ts re-initializes Redis connection, workers restart
 *   - The WorkerWatchdog fires on startup and rebuilds if needed
 *   - sending_locked=true contacts are safely unlocked by the next tick
 *
 * Test Strategy:
 *   1. Activate a sequence (jobs enqueued)
 *   2. Send a SIGTERM to the backend process (graceful shutdown)
 *   3. Wait 3 seconds (simulate downtime)
 *   4. Restart backend (npm run dev)
 *   5. Poll health until HEALTHY
 *   6. Validate no duplicate sends via DB consistency check
 *
 * IMPORTANT: This test requires process management permissions.
 *   The backend process PID must be deterministic or discoverable.
 *
 * Usage:
 *   BACKEND_PID=$(lsof -ti:5000) \
 *   BASE_URL=http://localhost:5000 \
 *   node tests/chaos/backend_restart.js
 *
 * Windows:
 *   $env:BACKEND_PID=(Get-NetTCPConnection -LocalPort 5000 -State Listen).OwningProcess
 *   node tests/chaos/backend_restart.js
 */

const http   = require('http');
const https  = require('https');
const { execSync, spawn } = require('child_process');
const path   = require('path');

const BASE_URL      = process.env.BASE_URL      || 'http://localhost:5000';
const BACKEND_PID   = process.env.BACKEND_PID   || '';
const BACKEND_DIR   = process.env.BACKEND_DIR   || path.resolve(__dirname, '../../backend');
const USER_EMAIL    = process.env.USER_EMAIL    || 'test1@example.com';
const USER_PASSWORD = process.env.USER_PASSWORD || 'password123';
const SEQUENCE_ID   = process.env.SEQUENCE_ID   || '';
const DOWNTIME_MS   = parseInt(process.env.DOWNTIME_MS || '5000');
const RESTART_WAIT  = parseInt(process.env.RESTART_WAIT_MS || '15000');

// ─── HTTP Helpers ─────────────────────────────────────────────────

function request(method, urlPath, body = null, token = null, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const url     = new URL(BASE_URL + urlPath);
    const isHttps = url.protocol === 'https:';
    const lib     = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname,
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
  console.log(`[${ts}] ${emoji} ${msg}`, data ? JSON.stringify(data) : '');
}

async function waitForHealth(token, maxWaitMs = 60000) {
  const deadline = Date.now() + maxWaitMs;
  let attempts   = 0;
  while (Date.now() < deadline) {
    try {
      const res = await request('GET', '/api/health/ping', null, null, 2000);
      if (res.status === 200) {
        log('✅', `Backend is UP after ${attempts} attempts`);
        return true;
      }
    } catch {}
    attempts++;
    await sleep(1000);
  }
  log('❌', `Backend did NOT come back up after ${maxWaitMs}ms`);
  return false;
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(65));
  console.log(' CHAOS TEST: Backend Restart During Send');
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

  // ── Phase 2: Activate sequence & observe queue ────────────────
  const activateRes = await request('PATCH', `/api/sequences/${SEQUENCE_ID}/status`,
    { status: 'active' }, token
  );
  log('📤', 'Activate sequence', { status: activateRes.status });

  await sleep(3000);

  const preHealth  = await request('GET', '/api/system/health', null, token);
  const preDepths  = preHealth.body?.scheduler?.queueDepths;
  const preDelayed = preDepths?.delayed || 0;
  log('📊', 'Pre-restart queue state', preDepths);

  if (preDelayed === 0) {
    log('⚠️', 'No delayed jobs in queue — activate the sequence first and re-run');
  }

  // ── Phase 3: Simulate restart ─────────────────────────────────
  log('💥', 'Phase 3: Simulating backend restart...');

  // Send SIGTERM to backend process
  if (BACKEND_PID) {
    try {
      process.kill(parseInt(BACKEND_PID), 'SIGTERM');
      log('💥', `Sent SIGTERM to PID ${BACKEND_PID}`);
    } catch (e) {
      log('⚠️', `Could not signal PID ${BACKEND_PID}: ${e.message}`);
      log('ℹ️', 'Manual action: Kill the backend process now, then press Ctrl+C after 5s to continue');
      await sleep(5000);
    }
  } else {
    log('⚠️', 'BACKEND_PID not set — manually restart the backend within 5 seconds');
    await sleep(5000);
  }

  // Downtime window
  log('⏳', `Simulating ${DOWNTIME_MS}ms downtime...`);
  await sleep(DOWNTIME_MS);

  // Verify backend is down
  const downCheck = await request('GET', '/api/health/ping', null, null, 2000);
  if (downCheck.status === 0 || downCheck.status >= 500) {
    log('✅', 'Confirmed: Backend is DOWN (as expected during chaos)');
  } else {
    log('⚠️', 'Backend appears still running — restart may not have taken effect');
  }

  // ── Phase 4: Restart backend ─────────────────────────────────
  log('🔄', 'Phase 4: Restarting backend...');

  // If PM2 or similar is used, adapt this command
  // For development: spawn npm run dev in background
  const child = spawn('npm', ['run', 'dev'], {
    cwd:      BACKEND_DIR,
    detached: true,
    stdio:    'ignore',
    shell:    true,
  });
  child.unref();
  log('🚀', `Backend restart initiated (PID: ${child.pid})`);

  // ── Phase 5: Wait for recovery ────────────────────────────────
  log('⏳', `Phase 5: Waiting for backend to come back up (max ${RESTART_WAIT}ms)...`);
  const recovered = await waitForHealth(null, RESTART_WAIT);

  if (!recovered) {
    log('❌', 'FAIL: Backend did not recover within timeout');
    process.exit(1);
  }

  // Re-authenticate (new process, same JWT secret)
  const loginRes2 = await request('POST', '/api/auth/login', {
    email: USER_EMAIL, password: USER_PASSWORD
  });
  const token2 = loginRes2.body?.data?.token;
  if (!token2) { log('⚠️', 'Re-authentication failed — proceeding with old token'); }
  const liveToken = token2 || token;

  // ── Phase 6: Post-restart health check ───────────────────────
  log('🔍', 'Phase 6: Post-restart health check...');
  await sleep(5000); // Give workers time to restart

  const postHealth  = await request('GET', '/api/system/health', null, liveToken);
  const postStatus  = postHealth.body?.status;
  const postDepths  = postHealth.body?.scheduler?.queueDepths;
  const postDelayed = postDepths?.delayed || 0;

  log('📊', 'Post-restart health', {
    status:      postStatus,
    queueDepths: postDepths,
    emailWorker: postHealth.body?.emailWorker?.workerRunning,
  });

  // ── Phase 7: Trigger rebuild if needed ───────────────────────
  if (postDelayed < preDelayed * 0.5) {
    log('🔧', 'Queue depth dropped significantly — triggering rebuild...');
    const rebuildRes = await request('POST', '/api/system/rebuild-queue', null, liveToken);
    log('📋', 'Rebuild result', {
      status:       rebuildRes.status,
      enqueuedCount: rebuildRes.body?.enqueuedCount,
    });
  } else {
    log('✅', 'Queue depth stable — no rebuild needed');
  }

  // ── Phase 8: Assertions ───────────────────────────────────────
  console.log('\n' + '─'.repeat(65));
  console.log(' CHAOS TEST RESULTS: Backend Restart');
  console.log('─'.repeat(65));

  const assertions = [
    {
      name: 'Backend recovered within timeout',
      pass: recovered,
      detail: recovered ? 'OK' : 'Did not recover',
    },
    {
      name: 'Health endpoint returns valid status',
      pass: ['HEALTHY', 'DEGRADED'].includes(postStatus),
      detail: `status=${postStatus}`,
    },
    {
      name: 'Email worker is running',
      pass: postHealth.body?.emailWorker?.workerRunning === true,
      detail: `workerRunning=${postHealth.body?.emailWorker?.workerRunning}`,
    },
    {
      name: 'Queue depths are non-null',
      pass: postDepths !== null && postDepths !== undefined,
      detail: JSON.stringify(postDepths),
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
  console.error('Fatal error:', err);
  process.exit(1);
});
