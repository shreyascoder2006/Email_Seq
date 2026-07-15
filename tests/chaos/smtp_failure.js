#!/usr/bin/env node

/**
 * tests/chaos/smtp_failure.js
 *
 * CHAOS TEST: SMTP Outage / Invalid Credentials
 *
 * Purpose:
 *   Simulate an SMTP server failure or credentials revocation during an active send.
 *
 * Usage:
 *   node tests/chaos/smtp_failure.js
 */

console.log('\n[CHAOS TEST] SMTP Failure Simulation\n');
console.log('Instructions for Manual Execution:');
console.log('1. Start the backend as normal.');
console.log('2. Create an active sequence with 20 contacts.');
console.log('3. While the sequence is sending, edit the backend/.env file and change SMTP_PASS to an invalid string.');
console.log('4. Observe the worker logs. They should start throwing SMTP connection/auth errors.');
console.log('5. Observe the database:');
console.log('   - SequenceContact.consecutive_failures increments.');
console.log('   - BullMQ moves jobs to delayed/failed states based on backoff strategy.');
console.log('6. After 2 minutes, fix the SMTP_PASS in .env and optionally restart backend to clear cached connections.');
console.log('7. Verify the worker resumes sending exactly where it left off.');
console.log('Expected Outcome: Failed jobs are retried. No skipped steps. No double sends.\n');
