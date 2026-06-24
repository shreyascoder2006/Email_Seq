import { computeNextSendAt } from '../src/services/enrollment.service';

const sendingWindow = {
  timezone: 'America/New_York',
  schedule: 'all_days',
  start_hour: 9,
  end_hour: 17,
};

const step = {
  delay_days: 0,
  delay_hours: 0,
  step_index: 0,
  type: 'email' as any,
  sequence_id: null as any,
  user_id: null as any,
  is_active: true,
};

function test() {
  console.log('Testing adjustToSendingWindow for America/New_York...');
  
  // Extract getLocalParts to test it
  const getLocalParts = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone:    sendingWindow.timezone,
      hour:        'numeric',
      hour12:      false,
      minute:      'numeric',
      weekday:     'short',
      year:        'numeric',
      month:       '2-digit',
      day:         '2-digit',
    }).formatToParts(d);

    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? '';

    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };

    return {
      rawHour: get('hour'),
      hour:    parseInt(get('hour'), 10),
      minute:  parseInt(get('minute'), 10),
      weekday: weekdayMap[get('weekday')] ?? 0,
    };
  };

  for (let h = 0; h < 24; h++) {
    const base = new Date(Date.UTC(2026, 5, 17, h, 0, 0));
    const parts = getLocalParts(base);
    const nextSend = computeNextSendAt(base, step as any, sendingWindow);
    const fmt = (d: Date) => d.toLocaleString('en-US', { timeZone: 'America/New_York' });
    console.log(`UTC ${h.toString().padStart(2, '0')} (NY: ${fmt(base)}) => Parsed rawHour: "${parts.rawHour}", hour: ${parts.hour} => Next Send (NY: ${fmt(nextSend)})`);
  }
}

test();
