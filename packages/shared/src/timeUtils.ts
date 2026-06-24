export interface SendingWindow {
  timezone: string;
  schedule: string; // 'custom' | 'all_days' | 'weekdays_only'
  custom_days?: number[];
  start_hour: number;
  start_minute?: number;
  end_hour: number;
  end_minute?: number;
}

/**
 * Helper to extract local hour, minute, and weekday from a Date in a specific timezone
 */
export function getLocalParts(d: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
    minute: 'numeric',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  // Note: Intl.DateTimeFormat with hour12: false can return '24' for midnight. We map it to '0'.
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;

  return {
    hour,
    minute: parseInt(get('minute'), 10),
    weekday: weekdayMap[get('weekday')] ?? 0,
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
  };
}

export function isAllowedDay(weekday: number, window: SendingWindow): boolean {
  if (window.schedule === 'all_days') return true;
  if (window.schedule === 'custom') {
    return (window.custom_days ?? []).includes(weekday);
  }
  // weekdays_only: Mon(1) – Fri(5)
  return weekday >= 1 && weekday <= 5;
}

/**
 * Validates if the given date is strictly within the allowed sending window.
 * Formula: startMinutes <= currentMinutes < endMinutes
 */
export function isSlotValid(date: Date, window: SendingWindow): boolean {
  const { hour, minute, weekday } = getLocalParts(date, window.timezone || 'UTC');

  if (!isAllowedDay(weekday, window)) {
    return false;
  }

  const currentMinutes = hour * 60 + minute;
  const startMinutes = window.start_hour * 60 + (window.start_minute || 0);
  const endMinutes = window.end_hour * 60 + (window.end_minute || 0);

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Calculates the exact next valid sending slot time based on the baseDate.
 * If the baseDate is currently valid, returns the baseDate (or skips to next minute if desired,
 * but for scheduling we usually want to start immediately if valid).
 */
export function calculateNextValidSlot(baseDate: Date, window: SendingWindow): Date {
  const startMinutes = window.start_hour * 60 + (window.start_minute || 0);
  const endMinutes = window.end_hour * 60 + (window.end_minute || 0);

  let candidate = new Date(baseDate);
  let iterations = 0;
  const MAX_ITER = 60; // 60 days max

  while (iterations++ < MAX_ITER) {
    const { hour, minute, weekday } = getLocalParts(candidate, window.timezone || 'UTC');
    const currentMinutes = hour * 60 + minute;

    if (!isAllowedDay(weekday, window)) {
      // Advance to midnight of the NEXT day in local time, then to startMinutes
      // Create a UTC date that represents the start time on the next day
      candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
      candidate = setLocalTime(candidate, window.timezone || 'UTC', startMinutes);
      continue;
    }

    if (currentMinutes < startMinutes) {
      // Before window — push to start of window today
      candidate = setLocalTime(candidate, window.timezone || 'UTC', startMinutes);
      continue;
    }

    if (currentMinutes >= endMinutes) {
      // After window — push to start of window NEXT day
      candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
      candidate = setLocalTime(candidate, window.timezone || 'UTC', startMinutes);
      continue;
    }

    // We're in a valid window!
    break;
  }

  return candidate;
}

/**
 * Helper to securely set the local time of a Date object to a specific minute-of-day
 * without being shifted by the server's own timezone offset.
 */
function setLocalTime(baseDate: Date, timezone: string, targetMinutesOfDay: number): Date {
  // We incrementally add or subtract time until the target minutes matches.
  // This avoids tricky Date math across DST boundaries.
  let current = new Date(baseDate);
  
  // Quick heuristic: calculate difference
  for (let i = 0; i < 48; i++) { // Max 48 attempts to prevent infinite loops (usually takes 1)
    const parts = getLocalParts(current, timezone);
    const currTotal = parts.hour * 60 + parts.minute;
    const diff = targetMinutesOfDay - currTotal;
    
    if (diff === 0) {
      // Exactly matched the hour and minute
      // Make sure seconds and ms are 0 for a clean start time
      current.setSeconds(0);
      current.setMilliseconds(0);
      return current;
    }

    // Adjust by the exact difference in minutes
    current = new Date(current.getTime() + diff * 60 * 1000);
  }

  return current;
}
