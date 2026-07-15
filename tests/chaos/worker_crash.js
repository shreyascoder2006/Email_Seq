#!/usr/bin/env node

/**
 * tests/chaos/worker_crash.js
 *
 * CHAOS TEST: Worker Crash Simulation
 *
 * Purpose:
 *   Simulate an abrupt worker crash (process killed) while actively processing
 *   email jobs. Verify that:
 *   1. The `sending_locked` flag on contacts expires after 5 minutes.
 *   2. The recovery engine detects the crashed worker and re-enqueues jobs.
 *   3. No emails are permanently lost.
 *   4. No duplicate emails are sent when the worker restarts.
 *
 * Usage:
 *   node tests/chaos/worker_crash.js
 */

const http = require('http');
const { execSync } = require('child_process');

console.log('\n[CHAOS TEST] Worker Crash Simulation\n');
console.log('Instructions for Manual Execution:');
console.log('1. Ensure you are running the backend workers in separate processes if possible, or identify the PID of the worker thread.');
console.log('2. Start a sequence with 100 contacts.');
console.log('3. While the queue depth is draining, forcefully kill the worker process:');
console.log('   Unix: kill -9 <PID>');
console.log('   Windows: taskkill /F /PID <PID>');
console.log('4. Wait for 5 minutes (the lock TTL for sending_locked).');
console.log('5. Restart the worker process.');
console.log('6. Observe the /api/system/health endpoint or BullMQ dashboard.');
console.log('7. Verify that the recovery engine unlocks the stalled contacts and re-enqueues them.');
console.log('8. Run check_db_consistency.js to ensure NO duplicate SendingLogs exist.\n');
console.log('Expected Outcome: 0 lost jobs, 0 duplicates. Auto-recovery succeeds.');
