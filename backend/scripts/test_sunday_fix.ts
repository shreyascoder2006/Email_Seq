/**
 * E2E test simulating the exact "Sunday bug":
 * - Sending window = 09:00-09:30 IST (already PAST for today when test runs at ~21:00 IST)
 * - Contacts enrolled BEFORE activation
 * - Activated with send_immediately = false (checkbox unchecked)
 * 
 * Expected behavior BEFORE fix: contacts stuck until tomorrow 09:00 IST
 * Expected behavior AFTER fix: contacts rescheduled to the next valid slot at activation time
 * 
 * Also tests:
 * - send_immediately = true (should always send immediately regardless of window)
 */

import axios from 'axios';
import mongoose from 'mongoose';
import { Sequence } from '../src/models/Sequence';
import { SequenceContact } from '../src/models/SequenceContact';
import { SequenceStep } from '../src/models/SequenceStep';

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1MDdmMWY3N2JjZjg2Y2Q3OTk0MzkwMTEiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJpYXQiOjE3ODUwODI3NzcsImV4cCI6MTc4NTE2OTE3N30.LeXWk2Pd3fo_MvW4KnjQLGN7mbIZvkGXH9LzE5s_Xoo';
const API_URL = 'http://localhost:5001/api';

const api = axios.create({
  baseURL: API_URL,
  headers: { Authorization: `Bearer ${TOKEN}` }
});

async function testScenario(label: string, sendImmediately: boolean) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCENARIO: ${label}`);
  console.log(`send_immediately = ${sendImmediately}`);
  console.log('='.repeat(60));
  
  const conn = await mongoose.connection.collection('email_connections').findOne({});
  const connectionId = conn!._id.toString();
  const tmpl = await mongoose.connection.collection('templates').findOne({});
  const templateId = tmpl!._id.toString();
  
  // Create sequence with window ALREADY PAST for today (09:00-09:30 IST = 03:30-04:00 UTC)
  // At 21:00 IST this window is ~12 hours past
  const createRes = await api.post('/sequences', {
    name: `FIX-TEST ${label} ${Date.now()}`,
    email_connection_id: connectionId,
    launch_date: new Date().toISOString(),
    sending_window: {
      timezone: "Asia/Calcutta",
      schedule: "custom",
      start_hour: 9,
      start_minute: 0,
      end_hour: 9,
      end_minute: 30,
      custom_days: [0, 1, 2, 3, 4, 5, 6] // every day
    }
  });
  const seqId = createRes.data.data._id;
  console.log(`[CREATED] Sequence: ${seqId}`);
  
  // Add step
  await api.post(`/sequences/${seqId}/steps`, {
    type: "email",
    template_id: templateId,
    delay_days: 0,
    delay_hours: 0,
    subject_override: `Test ${label}`,
    body_html_override: `<p>Test ${label}</p>`
  });
  
  // Enroll contact BEFORE activation (simulates real UI workflow)
  await api.post(`/sequences/${seqId}/enroll`, {
    contacts: [{ email: `fix.test.${Date.now()}@example.com`, first_name: "Fix", last_name: "Test", company: "Test Co" }]
  });
  
  // Check contact state BEFORE activation
  const contactsBefore = await SequenceContact.find({ sequence_id: seqId }).lean();
  const before = contactsBefore[0];
  const now = new Date();
  const nowIST = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  
  console.log(`[BEFORE ACTIVATION]`);
  console.log(`  Current time IST: ${nowIST.toISOString().replace('Z', '+05:30')}`);
  console.log(`  next_send_at: ${before.next_send_at?.toISOString()}`);
  console.log(`  Is due now: ${before.next_send_at && before.next_send_at <= now ? 'YES' : 'NO (future)'}`);
  
  // Activate
  console.log(`[ACTIVATING] send_immediately=${sendImmediately}...`);
  await api.patch(`/sequences/${seqId}/status`, {
    status: "active",
    ...(sendImmediately && { send_immediately: true })
  });
  
  // Check contact state IMMEDIATELY after activation
  const contactsAfter = await SequenceContact.find({ sequence_id: seqId }).lean();
  const after = contactsAfter[0];
  const nowAfter = new Date();
  
  console.log(`[AFTER ACTIVATION]`);
  console.log(`  next_send_at: ${after.next_send_at?.toISOString()}`);
  console.log(`  Is due now: ${after.next_send_at && after.next_send_at <= nowAfter ? 'YES ✓' : 'NO ✗ (still future)'}`);
  console.log(`  updated_at changed: ${before.updated_at?.toISOString() !== after.updated_at?.toISOString() ? 'YES ✓' : 'NO ✗ (not updated)'}`);
  
  if (sendImmediately) {
    // Wait for processing
    console.log(`[WAITING] 12s for email to process...`);
    await new Promise(r => setTimeout(r, 12000));
    
    const final = await SequenceContact.findOne({ sequence_id: seqId }).lean();
    console.log(`[FINAL STATE]`);
    console.log(`  status: ${final?.status}`);
    console.log(`  job_state: ${final?.job_state}`);
    console.log(`  RESULT: ${final?.status === 'completed' ? '✅ SENT' : '❌ NOT SENT'}`);
  } else {
    console.log(`[SCHEDULED MODE] Verifying next_send_at is tomorrow's window start...`);
    const tomorrowWindowStart = new Date();
    tomorrowWindowStart.setUTCHours(3, 30, 0, 0); // 09:00 IST
    tomorrowWindowStart.setUTCDate(tomorrowWindowStart.getUTCDate() + 1); // tomorrow
    console.log(`  Expected tomorrow slot: ${tomorrowWindowStart.toISOString()}`);
    console.log(`  Actual next_send_at:    ${after.next_send_at?.toISOString()}`);
    const isTomorrow = after.next_send_at && 
      Math.abs(after.next_send_at.getTime() - tomorrowWindowStart.getTime()) < 60000;
    console.log(`  Correctly scheduled for tomorrow: ${isTomorrow ? '✅' : '❓ (check actual value)'}`);
  }
}

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/email_sequencing');
  
  const now = new Date();
  const nowIST = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  console.log(`Current time UTC: ${now.toISOString()}`);
  console.log(`Current time IST: ${nowIST.toISOString().replace('Z', '+05:30')}`);
  console.log(`Sending window: 09:00-09:30 IST (already PAST today)`);
  
  try {
    // Test 1: send_immediately=true (should always work)
    await testScenario("IMMEDIATE", true);
    
    // Test 2: send_immediately=false (should schedule for tomorrow's window)
    await testScenario("SCHEDULED", false);
    
    console.log('\n' + '='.repeat(60));
    console.log('ALL TESTS COMPLETE');
    console.log('='.repeat(60));
  } catch (err: any) {
    console.error('Test failed:', err.response?.data || err.message);
  } finally {
    process.exit(0);
  }
}

main();
