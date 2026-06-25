import { DateTime } from 'luxon';
import { SendingSchedule } from '../models/Sequence';
import { SendingWindow } from '../models/Sequence'; // Ensure SendingWindow is importable or redefine it here. Actually the model has it.
import logger from '../config/logger';

export interface SchedulerDecision {
  sequenceId: string;
  contactId: string;
  nowUtc: string;
  sequenceTimezone: string;
  localNow: string;
  activeDays: string[];
  window: { start: string; end: string };
  launchDateLocal: string | null;
  contactNextSendAtUtc: string | null;
  contactNextSendAtLocal: string | null;
  decision: 'enqueue_now' | 'skip_future_campaign' | 'skip_outside_window' | 'skip_invalid_day' | 'reschedule_to_next_slot' | 'skip_not_due';
  computedNextSendAtUtc: string | null;
  computedNextSendAtLocal: string | null;
  reason: string;
}

/**
 * Returns true if the weekday (1=Mon ... 7=Sun in Luxon) is allowed.
 * Note: Our custom_days map in MongoDB was 0=Sun..6=Sat. 
 * Luxon weekday is 1=Mon, 2=Tue... 7=Sun.
 */
export function isAllowedWeekday(luxonWeekday: number, window: SendingWindow): boolean {
  if (window.schedule === SendingSchedule.ALL_DAYS) return true;
  
  if (window.schedule === SendingSchedule.CUSTOM) {
    // Map Luxon weekday (1-7) to MongoDB custom_days (0-6)
    // Luxon: 7 = Sunday -> Mongo: 0
    // Luxon: 1 = Monday -> Mongo: 1
    const mongoDay = luxonWeekday === 7 ? 0 : luxonWeekday;
    return (window.custom_days ?? []).includes(mongoDay);
  }
  
  // Weekdays only (Mon=1 ... Fri=5)
  return luxonWeekday >= 1 && luxonWeekday <= 5;
}

/**
 * Validates if the given DateTime is strictly within the allowed sending window time of day.
 * Formula: startMinutes <= currentMinutes < endMinutes
 */
export function isWithinSendingWindow(localDt: DateTime, window: SendingWindow): boolean {
  const currentMinutes = localDt.hour * 60 + localDt.minute;
  const startMinutes = window.start_hour * 60 + window.start_minute;
  const endMinutes = window.end_hour * 60 + window.end_minute;
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Calculates the exact next valid sending slot time based on the baseDate.
 * If baseDate < launchDate, it first jumps to launchDate.
 */
export function calculateNextValidSlot(baseDate: Date, window: SendingWindow, launchDate?: Date): Date {
  let candidate = DateTime.fromJSDate(baseDate).setZone(window.timezone);
  
  if (launchDate) {
    const launchDt = DateTime.fromJSDate(launchDate).setZone(window.timezone);
    if (candidate < launchDt) {
      candidate = launchDt;
    }
  }

  const startMinutes = window.start_hour * 60 + window.start_minute;
  const endMinutes = window.end_hour * 60 + window.end_minute;

  let iterations = 0;
  const MAX_ITER = 60; // Max 60 days to prevent infinite loops

  while (iterations++ < MAX_ITER) {
    const currentMinutes = candidate.hour * 60 + candidate.minute;
    const isAllowedDay = isAllowedWeekday(candidate.weekday, window);

    if (!isAllowedDay) {
      // Move to next day at window start
      candidate = candidate.plus({ days: 1 }).set({ hour: window.start_hour, minute: window.start_minute, second: 0, millisecond: 0 });
      continue;
    }

    if (currentMinutes < startMinutes) {
      // Move to window start today
      candidate = candidate.set({ hour: window.start_hour, minute: window.start_minute, second: 0, millisecond: 0 });
      continue;
    }

    if (currentMinutes >= endMinutes) {
      // Move to window start NEXT day
      candidate = candidate.plus({ days: 1 }).set({ hour: window.start_hour, minute: window.start_minute, second: 0, millisecond: 0 });
      continue;
    }

    // It's a valid day and time
    break;
  }

  return candidate.toJSDate();
}

/**
 * Returns true if the date is currently within the active day and time window, and is >= launchDate.
 */
export function isSlotValid(date: Date, window: SendingWindow, launchDate?: Date): boolean {
  const dt = DateTime.fromJSDate(date).setZone(window.timezone);

  if (launchDate) {
    const launchDt = DateTime.fromJSDate(launchDate).setZone(window.timezone);
    if (dt < launchDt) return false;
  }

  if (!isAllowedWeekday(dt.weekday, window)) return false;
  if (!isWithinSendingWindow(dt, window)) return false;

  return true;
}

export function toSequenceLocalTime(date: Date, timezone: string): DateTime {
  return DateTime.fromJSDate(date).setZone(timezone);
}
