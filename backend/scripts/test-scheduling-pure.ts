import { DateTime } from 'luxon';
import { calculateNextValidSlot, SchedulerDecision } from '../src/utils/scheduling';
import { SendingSchedule } from '../src/models/Sequence';

function runTest(name: string, fn: () => void) {
  try {
    process.stdout.write(`\n--- RUNNING SCENARIO: ${name} ---\n`);
    fn();
    console.log(`✅ PASS: ${name}`);
  } catch (err: any) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err.message);
  }
}

function main() {
  console.log("Starting pure logic tests...");

  // Scenario A: US Timezone + 30-min window
  runTest('Scenario A - Before Window', () => {
    const tz = 'America/New_York';
    const now = DateTime.fromObject({ year: 2026, month: 7, day: 1, hour: 8, minute: 0 }, { zone: tz }).toJSDate();
    const window = { timezone: tz, schedule: SendingSchedule.WEEKDAYS_ONLY, start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    const nextSlot = calculateNextValidSlot(now, window as any);
    const expected = DateTime.fromObject({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }, { zone: tz }).toUTC().toISO();
    if (DateTime.fromJSDate(nextSlot).toUTC().toISO() !== expected) {
       throw new Error(`Expected ${expected}, got ${DateTime.fromJSDate(nextSlot).toUTC().toISO()}`);
    }
  });

  runTest('Scenario A - After Window', () => {
    const tz = 'America/New_York';
    const now = DateTime.fromObject({ year: 2026, month: 7, day: 1, hour: 10, minute: 0 }, { zone: tz }).toJSDate();
    const window = { timezone: tz, schedule: SendingSchedule.WEEKDAYS_ONLY, start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    const nextSlot = calculateNextValidSlot(now, window as any);
    const expected = DateTime.fromObject({ year: 2026, month: 7, day: 2, hour: 9, minute: 0 }, { zone: tz }).toUTC().toISO();
    if (DateTime.fromJSDate(nextSlot).toUTC().toISO() !== expected) {
       throw new Error(`Expected ${expected}, got ${DateTime.fromJSDate(nextSlot).toUTC().toISO()}`);
    }
  });

  runTest('Scenario B - Future Campaign', () => {
    const tz = 'America/New_York';
    const now = DateTime.fromObject({ year: 2026, month: 7, day: 20, hour: 9, minute: 15 }, { zone: tz }).toJSDate(); // July 20
    const launchDate = DateTime.fromObject({ year: 2026, month: 8, day: 1, hour: 0, minute: 0 }, { zone: tz }).toJSDate();
    const window = { timezone: tz, schedule: SendingSchedule.ALL_DAYS, start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    const nextSlot = calculateNextValidSlot(now, window as any, launchDate);
    const expected = DateTime.fromObject({ year: 2026, month: 8, day: 1, hour: 9, minute: 0 }, { zone: tz }).toUTC().toISO();
    if (DateTime.fromJSDate(nextSlot).toUTC().toISO() !== expected) {
       throw new Error(`Expected ${expected}, got ${DateTime.fromJSDate(nextSlot).toUTC().toISO()}`);
    }
  });

  runTest('Scenario C - Weekday Restriction (Mon/Wed/Fri)', () => {
    const tz = 'America/New_York';
    // July 7, 2026 is a Tuesday
    const now = DateTime.fromObject({ year: 2026, month: 7, day: 7, hour: 9, minute: 15 }, { zone: tz }).toJSDate();
    const window = { timezone: tz, schedule: SendingSchedule.CUSTOM, custom_days: [1, 3, 5], start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    const nextSlot = calculateNextValidSlot(now, window as any);
    const expected = DateTime.fromObject({ year: 2026, month: 7, day: 8, hour: 9, minute: 0 }, { zone: tz }).toUTC().toISO();
    if (DateTime.fromJSDate(nextSlot).toUTC().toISO() !== expected) {
       throw new Error(`Expected ${expected}, got ${DateTime.fromJSDate(nextSlot).toUTC().toISO()}`);
    }
  });

  runTest('Scenario D - Weekend Only', () => {
    const tz = 'America/New_York';
    // July 7 is Tuesday
    const now = DateTime.fromObject({ year: 2026, month: 7, day: 7, hour: 9, minute: 15 }, { zone: tz }).toJSDate();
    const window = { timezone: tz, schedule: SendingSchedule.CUSTOM, custom_days: [0, 6], start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    const nextSlot = calculateNextValidSlot(now, window as any);
    const expected = DateTime.fromObject({ year: 2026, month: 7, day: 11, hour: 9, minute: 0 }, { zone: tz }).toUTC().toISO();
    if (DateTime.fromJSDate(nextSlot).toUTC().toISO() !== expected) {
       throw new Error(`Expected ${expected}, got ${DateTime.fromJSDate(nextSlot).toUTC().toISO()}`);
    }
  });

  runTest('Scenario E - DST Safety', () => {
    const tz = 'America/New_York';
    const baseBeforeDST = DateTime.fromObject({ year: 2026, month: 3, day: 7, hour: 10, minute: 0 }, { zone: tz }).toJSDate();
    const window = { timezone: tz, schedule: SendingSchedule.ALL_DAYS, start_hour: 9, start_minute: 0, end_hour: 9, end_minute: 30 };
    const nextSlot = calculateNextValidSlot(baseBeforeDST, window as any);
    const nextSlotDt = DateTime.fromJSDate(nextSlot).setZone(tz);
    if (nextSlotDt.hour !== 9 || nextSlotDt.minute !== 0 || nextSlotDt.day !== 8) {
       throw new Error(`DST shift broke local hour. Got: ${nextSlotDt.toISO()}`);
    }
  });

  console.log('\n✅ All scheduling scenarios complete.');
}

main();
