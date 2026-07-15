#!/usr/bin/env node

/**
 * tests/chaos/mongo_outage.js
 *
 * CHAOS TEST: MongoDB Network Outage Simulation
 *
 * Purpose:
 *   Simulate a MongoDB disconnection and observe system degradation.
 *
 * Usage:
 *   node tests/chaos/mongo_outage.js
 */

console.log('\n[CHAOS TEST] MongoDB Outage Simulation\n');
console.log('Instructions for Manual Execution:');
console.log('1. Ensure backend is running.');
console.log('2. Stop the local MongoDB service or drop firewall packets to port 27017:');
console.log('   Windows: net stop MongoDB');
console.log('   Unix: sudo systemctl stop mongod');
console.log('3. Poll /api/system/health. The status should transition to DEGRADED or UNHEALTHY.');
console.log('4. Try to start a sequence or process jobs. Workers should back off since they cannot acquire locks or fetch schedules.');
console.log('5. Restart MongoDB service.');
console.log('6. Verify backend Mongoose connection auto-reconnects.');
console.log('7. Verify jobs resume successfully.\n');
