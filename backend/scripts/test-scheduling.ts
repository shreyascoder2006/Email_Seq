import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import sinon from 'sinon';
import { Sequence, SendingSchedule } from '../src/models/Sequence';
import { SequenceContact } from '../src/models/SequenceContact';
import { calculateNextValidSlot, SchedulerDecision } from '../src/utils/scheduling';
import { runScheduler } from '../src/queues/schedulerQueue';
import { env } from '../src/config/env';

// Intercept console.log/info to capture SchedulerDecision logs
let lastDecisionLog: SchedulerDecision | null = null;
const originalInfo = console.info;

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    process.stdout.write(`\n--- RUNNING SCENARIO: ${name} ---\n`);
    await fn();
    console.log(`✅ PASS: ${name}`);
  } catch (err: any) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err.message);
  }
}

async function setupTestDb() {
  await mongoose.connect(env.MONGO_URI);
  await Sequence.deleteMany({ name: /^test_scenario_/ });
  await SequenceContact.deleteMany({ contact_email: /@testscenario\.com$/ });
}

async function createScenarioData(name: string, window: any, launchDate: Date | null, contactNextSendAt: Date | null) {
  const sequence = await Sequence.create({
    user_id: new mongoose.Types.ObjectId(),
    name: `test_scenario_${name}`,
    sending_window: window,
    launch_date: launchDate,
    status: 'active'
  });
  
  const contact = await SequenceContact.create({
    sequence_id: sequence._id,
    user_id: sequence.user_id,
    contact_email: `${name}@testscenario.com`,
    status: 'active',
    current_step_index: 0,
    next_send_at: contactNextSendAt
  });
  
  return { sequence, contact };
}

async function main() {
  console.log("Starting test-scheduling...");
  await setupTestDb();
  console.log("Test DB connected.");

  // Override logger to capture decision
  const logger = require('../src/config/logger').default;
  const originalLog = logger.info.bind(logger);
  logger.info = (msg: string, meta?: any) => {
    if (msg.includes('DEBUG SCHEDULER DIAGNOSTIC:')) {
      lastDecisionLog = JSON.parse(msg.replace('DEBUG SCHEDULER DIAGNOSTIC: ', ''));
    }
    // originalLog(msg, meta);
  };

  // -----------------------------------------------------
  // Scenario A: US Timezone + 30-min window
  // -----------------------------------------------------
  await runTest('Scenario A - Before Window', async () => {
    const tz = 'America/New_York';
    const nowMock = DateTime.fromObject({ year: 2026, month: 7, day: 1, hour: 8, minute: 0 }, { zone: tz }).toJSDate();
    const window = { timezone: tz, schedule: SendingSchedule.WEEKDAYS_ONLY, start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    
    // Contact due now
    await createScenarioData('A1', window, null, nowMock);
    await runScheduler(undefined, nowMock);
    
    if (lastDecisionLog?.decision !== 'skip_outside_window') throw new Error(`Expected skip_outside_window, got ${lastDecisionLog?.decision}`);
  });

  await runTest('Scenario A - During Window', async () => {
    const tz = 'America/New_York';
    const nowMock = DateTime.fromObject({ year: 2026, month: 7, day: 1, hour: 9, minute: 15 }, { zone: tz }).toJSDate();
    const window = { timezone: tz, schedule: SendingSchedule.WEEKDAYS_ONLY, start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    
    await createScenarioData('A2', window, null, nowMock);
    await runScheduler(undefined, nowMock);
    
    if (lastDecisionLog?.decision !== 'enqueue_now') throw new Error(`Expected enqueue_now, got ${lastDecisionLog?.decision}`);
  });

  await runTest('Scenario A - After Window', async () => {
    const tz = 'America/New_York';
    const nowMock = DateTime.fromObject({ year: 2026, month: 7, day: 1, hour: 10, minute: 0 }, { zone: tz }).toJSDate();
    const window = { timezone: tz, schedule: SendingSchedule.WEEKDAYS_ONLY, start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    
    const { contact } = await createScenarioData('A3', window, null, nowMock);
    await runScheduler(undefined, nowMock);
    
    if (lastDecisionLog?.decision !== 'skip_outside_window') throw new Error(`Expected skip_outside_window, got ${lastDecisionLog?.decision}`);
    
    // Should have rescheduled to next day 9:00
    const updated = await SequenceContact.findById(contact._id);
    const expected = DateTime.fromObject({ year: 2026, month: 7, day: 2, hour: 9, minute: 0 }, { zone: tz }).toUTC().toISO();
    if (DateTime.fromJSDate(updated!.next_send_at!).toUTC().toISO() !== expected) {
      throw new Error(`Rescheduled time incorrect. Expected ${expected}, got ${updated!.next_send_at!.toISOString()}`);
    }
  });

  // -----------------------------------------------------
  // Scenario B: Future Campaign / Schedule Later
  // -----------------------------------------------------
  await runTest('Scenario B - Future Campaign', async () => {
    const tz = 'America/New_York';
    const launchDate = DateTime.fromObject({ year: 2026, month: 8, day: 1, hour: 0, minute: 0 }, { zone: tz }).toJSDate();
    const nowMock = DateTime.fromObject({ year: 2026, month: 7, day: 20, hour: 9, minute: 15 }, { zone: tz }).toJSDate(); // July 20
    const window = { timezone: tz, schedule: SendingSchedule.ALL_DAYS, start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    
    const { contact } = await createScenarioData('B1', window, launchDate, nowMock);
    await runScheduler(undefined, nowMock);
    
    if (lastDecisionLog?.decision !== 'skip_future_campaign') throw new Error(`Expected skip_future_campaign, got ${lastDecisionLog?.decision}`);
    
    const updated = await SequenceContact.findById(contact._id);
    const expected = DateTime.fromObject({ year: 2026, month: 8, day: 1, hour: 9, minute: 0 }, { zone: tz }).toUTC().toISO();
    if (DateTime.fromJSDate(updated!.next_send_at!).toUTC().toISO() !== expected) {
       throw new Error(`Did not jump to launch date. Expected ${expected}, got ${updated!.next_send_at!.toISOString()}`);
    }
  });

  // -----------------------------------------------------
  // Scenario C: Weekday Restriction
  // -----------------------------------------------------
  await runTest('Scenario C - Weekday Restriction (Mon/Wed/Fri)', async () => {
    const tz = 'America/New_York';
    // July 7, 2026 is a Tuesday
    const nowMock = DateTime.fromObject({ year: 2026, month: 7, day: 7, hour: 9, minute: 15 }, { zone: tz }).toJSDate();
    // 1=Mon, 3=Wed, 5=Fri
    const window = { timezone: tz, schedule: SendingSchedule.CUSTOM, custom_days: [1, 3, 5], start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    
    const { contact } = await createScenarioData('C1', window, null, nowMock);
    await runScheduler(undefined, nowMock);
    
    if (lastDecisionLog?.decision !== 'skip_invalid_day') throw new Error(`Expected skip_invalid_day, got ${lastDecisionLog?.decision}`);
    
    // Should move to Wednesday July 8 at 9:00
    const updated = await SequenceContact.findById(contact._id);
    const expected = DateTime.fromObject({ year: 2026, month: 7, day: 8, hour: 9, minute: 0 }, { zone: tz }).toUTC().toISO();
    if (DateTime.fromJSDate(updated!.next_send_at!).toUTC().toISO() !== expected) {
       throw new Error(`Expected ${expected}, got ${updated!.next_send_at!.toISOString()}`);
    }
  });

  // -----------------------------------------------------
  // Scenario D: Weekend-only schedule
  // -----------------------------------------------------
  await runTest('Scenario D - Weekend Only', async () => {
    const tz = 'America/New_York';
    // July 7 is Tuesday
    const nowMock = DateTime.fromObject({ year: 2026, month: 7, day: 7, hour: 9, minute: 15 }, { zone: tz }).toJSDate();
    // 0=Sun, 6=Sat
    const window = { timezone: tz, schedule: SendingSchedule.CUSTOM, custom_days: [0, 6], start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    
    const { contact } = await createScenarioData('D1', window, null, nowMock);
    await runScheduler(undefined, nowMock);
    
    if (lastDecisionLog?.decision !== 'skip_invalid_day') throw new Error(`Expected skip_invalid_day`);
    
    // Next Saturday is July 11
    const updated = await SequenceContact.findById(contact._id);
    const expected = DateTime.fromObject({ year: 2026, month: 7, day: 11, hour: 9, minute: 0 }, { zone: tz }).toUTC().toISO();
    if (DateTime.fromJSDate(updated!.next_send_at!).toUTC().toISO() !== expected) {
       throw new Error(`Expected Saturday ${expected}, got ${updated!.next_send_at!.toISOString()}`);
    }
  });

  // -----------------------------------------------------
  // Scenario E: DST Safety
  // -----------------------------------------------------
  await runTest('Scenario E - DST Safety', async () => {
    const tz = 'America/New_York';
    // Spring forward in US was Mar 8, 2026.
    const window = { timezone: tz, schedule: SendingSchedule.ALL_DAYS, start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    
    const baseBeforeDST = DateTime.fromObject({ year: 2026, month: 3, day: 7, hour: 10, minute: 0 }, { zone: tz }).toJSDate();
    
    const nextSlot = calculateNextValidSlot(baseBeforeDST, window as any, undefined);
    const nextSlotDt = DateTime.fromJSDate(nextSlot).setZone(tz);
    
    if (nextSlotDt.hour !== 9 || nextSlotDt.minute !== 0 || nextSlotDt.day !== 8) {
       throw new Error(`DST shift broke local hour. Got: ${nextSlotDt.toISO()}`);
    }
  });

  // -----------------------------------------------------
  // Scenario K: Future valid next_send_at -> skip_not_due
  // -----------------------------------------------------
  await runTest('Scenario K - skip_not_due', async () => {
    const tz = 'America/New_York';
    const nowMock = DateTime.fromObject({ year: 2026, month: 7, day: 1, hour: 8, minute: 0 }, { zone: tz }).toJSDate();
    const window = { timezone: tz, schedule: SendingSchedule.ALL_DAYS, start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    
    // Due at 9:15
    const futureDate = DateTime.fromObject({ year: 2026, month: 7, day: 1, hour: 9, minute: 15 }, { zone: tz }).toJSDate();
    const { contact } = await createScenarioData('K1', window, null, futureDate);
    await runScheduler(undefined, nowMock);
    
    if (lastDecisionLog?.decision !== 'skip_not_due') throw new Error(`Expected skip_not_due, got ${lastDecisionLog?.decision}`);
    
    const updated = await SequenceContact.findById(contact._id);
    if (updated!.next_send_at!.toISOString() !== futureDate.toISOString()) {
      throw new Error(`Should not have rescheduled.`);
    }
  });

  await mongoose.disconnect();
  console.log('\n✅ All scheduling scenarios complete.');
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
