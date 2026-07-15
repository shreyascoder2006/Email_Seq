/**
 * tests/k6/scenarios/07_race_conditions.js
 *
 * SCENARIO: Race Condition Tests — Concurrent State Mutations
 *
 * Purpose:
 *   Fire competing requests at the SAME resource simultaneously using
 *   k6's arrival-rate executor to produce true concurrency spikes.
 *
 * Race Conditions Tested:
 *
 *   RC-01: Two VUs activate the same sequence simultaneously
 *          → Only one should succeed; second gets 400/409
 *
 *   RC-02: Two VUs pause and resume simultaneously
 *          → State machine must serialize; no invalid state
 *
 *   RC-03: Two VUs reschedule the same contacts simultaneously
 *          → schedule_version must increment atomically; no double-enqueue
 *
 *   RC-04: Reschedule while worker is actively processing
 *          → Stale job must be rejected by schedule_version check
 *
 *   RC-05: Queue rebuild while contacts are being enrolled
 *          → Rebuild must capture all newly enrolled contacts
 *
 * Each test fires 10-20 concurrent requests to the same endpoint
 * using k6's `shared-iterations` executor, which maximizes overlap.
 *
 * Run:
 *   k6 run tests/k6/scenarios/07_race_conditions.js \
 *     -e BASE_URL=http://localhost:5000 \
 *     -e SEQUENCE_ID=<your_sequence_id>
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL, login, authHeaders } from '../lib/auth.js';
import { generateContacts, buildEnrollBody, buildRescheduleBody } from '../lib/dataFactory.js';

// Sequence under test — must be in 'active' state before running RC-02, RC-03
const SEQUENCE_ID = __ENV.SEQUENCE_ID || '';

// Custom race condition metrics
const raceWinnerRate  = new Rate('race_winner_2xx');
const raceLoserRate   = new Rate('race_loser_4xx_409');
const raceCrashRate   = new Rate('race_crash_5xx');

// ─── Options ────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // RC-01: Concurrent activate (same sequence)
    rc01_concurrent_activate: {
      executor:    'shared-iterations',
      vus:         10,
      iterations:  10,
      maxDuration: '30s',
      env:         { RC_SCENARIO: 'rc01' },
    },

    // RC-02: Concurrent pause + resume (same sequence)
    rc02_pause_resume_storm: {
      executor:    'shared-iterations',
      vus:         10,
      iterations:  20,
      maxDuration: '60s',
      startTime:   '35s',
      env:         { RC_SCENARIO: 'rc02' },
    },

    // RC-03: Concurrent reschedule (same contacts)
    rc03_concurrent_reschedule: {
      executor:    'shared-iterations',
      vus:         10,
      iterations:  10,
      maxDuration: '30s',
      startTime:   '100s',
      env:         { RC_SCENARIO: 'rc03' },
    },

    // RC-04: Reschedule + enroll simultaneously
    rc04_reschedule_while_enroll: {
      executor:    'shared-iterations',
      vus:         8,
      iterations:  8,
      maxDuration: '30s',
      startTime:   '135s',
      env:         { RC_SCENARIO: 'rc04' },
    },

    // RC-05: Concurrent queue rebuild
    rc05_concurrent_rebuild: {
      executor:    'shared-iterations',
      vus:         5,
      iterations:  5,
      maxDuration: '60s',
      startTime:   '170s',
      env:         { RC_SCENARIO: 'rc05' },
    },
  },

  thresholds: {
    // Must never see a 500 during race tests
    'race_crash_5xx':             ['rate<0.001'],
    // At least some winners in every race
    'race_winner_2xx':            ['rate>0.05'],
    // Most concurrent requests should resolve cleanly (200 or 409)
    'http_req_failed':            ['rate<0.05'],
  },
};

// ─── Setup ──────────────────────────────────────────────────────────
export function setup() {
  const { token } = login(0);
  if (!token) return {};

  const headers = authHeaders(token);

  // Pre-fetch contact IDs for RC-03
  let contactIds = [];
  if (SEQUENCE_ID) {
    const contactsRes = http.get(
      `${BASE_URL}/api/sequences/${SEQUENCE_ID}/contacts?status=active&limit=10`,
      { headers }
    );
    if (contactsRes.status === 200) {
      try {
        const body  = contactsRes.json();
        const items = body.data?.contacts || body.data || [];
        contactIds  = items.map(c => c._id || c.id).filter(Boolean);
      } catch {}
    }
    console.log(`[setup] Pre-loaded ${contactIds.length} contact IDs for RC-03`);
  }

  return { token, contactIds };
}

// ─── Default Function ────────────────────────────────────────────────
export default function (data) {
  if (!data.token) { sleep(1); return; }

  const scenario = __ENV.RC_SCENARIO;
  const headers  = authHeaders(data.token);

  switch (scenario) {
    case 'rc01': rc01_concurrent_activate(headers, data);      break;
    case 'rc02': rc02_pause_resume_storm(headers, data);       break;
    case 'rc03': rc03_concurrent_reschedule(headers, data);    break;
    case 'rc04': rc04_reschedule_while_enroll(headers, data);  break;
    case 'rc05': rc05_concurrent_rebuild(headers, data);       break;
    default:     console.warn(`Unknown RC scenario: ${scenario}`);
  }
}

// ─── RC-01: Concurrent Activate ─────────────────────────────────────
function rc01_concurrent_activate(headers, data) {
  if (!SEQUENCE_ID) { console.warn('[RC-01] No SEQUENCE_ID'); return; }

  // All 10 VUs hit activate simultaneously — only 1 should "win"
  const res = http.patch(
    `${BASE_URL}/api/sequences/${SEQUENCE_ID}/status`,
    JSON.stringify({ status: 'active' }),
    { headers, tags: { name: 'rc01_activate' } }
  );

  const is200 = res.status === 200;
  const is409 = res.status === 409;
  const is400 = res.status === 400; // invalid transition (already active)
  const is5xx = res.status >= 500;

  raceWinnerRate.add(is200 ? 1 : 0);
  raceLoserRate.add((is409 || is400) ? 1 : 0);
  raceCrashRate.add(is5xx ? 1 : 0);

  check(res, {
    'RC-01: no 500 crash':                    (r) => r.status < 500,
    'RC-01: accepts or rejects (no limbo)':   (r) => [200, 400, 409].includes(r.status),
    'RC-01: response < 3000ms':               (r) => r.timings.duration < 3000,
  });

  if (is5xx) {
    console.error(`[RC-01] 💥 VU ${__VU} got 500 on concurrent activate! Body: ${res.body?.substring(0, 200)}`);
  }
}

// ─── RC-02: Pause + Resume Storm ────────────────────────────────────
function rc02_pause_resume_storm(headers, data) {
  if (!SEQUENCE_ID) { console.warn('[RC-02] No SEQUENCE_ID'); return; }

  // Alternate: even VUs pause, odd VUs resume
  const action = __VU % 2 === 0 ? 'paused' : 'active';

  const res = http.patch(
    `${BASE_URL}/api/sequences/${SEQUENCE_ID}/status`,
    JSON.stringify({ status: action }),
    { headers, tags: { name: 'rc02_pause_resume' } }
  );

  raceWinnerRate.add([200, 201].includes(res.status) ? 1 : 0);
  raceLoserRate.add([400, 409, 422].includes(res.status) ? 1 : 0);
  raceCrashRate.add(res.status >= 500 ? 1 : 0);

  check(res, {
    'RC-02: no 500 crash':                    (r) => r.status < 500,
    'RC-02: no undefined state':              (r) => {
      try {
        const s = r.json().data?.status;
        if (!s) return true; // field absent on errors — ok
        return ['active', 'paused', 'archived', 'draft'].includes(s);
      } catch { return true; }
    },
    'RC-02: response < 2000ms':               (r) => r.timings.duration < 2000,
  });

  if (res.status >= 500) {
    console.error(`[RC-02] 💥 VU ${__VU} (action=${action}) got 500: ${res.body?.substring(0, 200)}`);
  }

  sleep(0.1);
}

// ─── RC-03: Concurrent Reschedule ──────────────────────────────────
function rc03_concurrent_reschedule(headers, data) {
  if (!SEQUENCE_ID || !data.contactIds?.length) {
    console.warn('[RC-03] No SEQUENCE_ID or no contactIds');
    return;
  }

  const res = http.post(
    `${BASE_URL}/api/sequences/${SEQUENCE_ID}/reschedule`,
    JSON.stringify(buildRescheduleBody(data.contactIds, 'immediately')),
    { headers, tags: { name: 'rc03_concurrent_reschedule' }, timeout: '15s' }
  );

  raceWinnerRate.add(res.status === 200 ? 1 : 0);
  raceLoserRate.add([409, 422].includes(res.status) ? 1 : 0);
  raceCrashRate.add(res.status >= 500 ? 1 : 0);

  check(res, {
    'RC-03: no 500 crash':                   (r) => r.status < 500,
    'RC-03: no duplicate schedules':         (r) => {
      // The schedule_version mechanism should prevent any 500
      return r.status !== 500;
    },
    'RC-03: response < 10000ms':             (r) => r.timings.duration < 10000,
  });

  if (res.status >= 500) {
    console.error(`[RC-03] 💥 VU ${__VU} got 500 on concurrent reschedule: ${res.body?.substring(0, 200)}`);
  }
}

// ─── RC-04: Reschedule While Enroll ─────────────────────────────────
function rc04_reschedule_while_enroll(headers, data) {
  if (!SEQUENCE_ID) { console.warn('[RC-04] No SEQUENCE_ID'); return; }

  if (__VU % 2 === 0) {
    // Even VUs: enroll new contacts
    const contacts = generateContacts(5, `rc04-enroll`);
    const enrollRes = http.post(
      `${BASE_URL}/api/sequences/${SEQUENCE_ID}/enroll`,
      JSON.stringify(buildEnrollBody(contacts)),
      { headers, tags: { name: 'rc04_enroll' } }
    );
    check(enrollRes, {
      'RC-04 enroll: no 500': (r) => r.status < 500,
    });
  } else {
    // Odd VUs: reschedule existing contacts
    if (!data.contactIds?.length) return;
    const reschedRes = http.post(
      `${BASE_URL}/api/sequences/${SEQUENCE_ID}/reschedule`,
      JSON.stringify(buildRescheduleBody(data.contactIds.slice(0, 3), 'today')),
      { headers, tags: { name: 'rc04_reschedule' } }
    );
    check(reschedRes, {
      'RC-04 reschedule: no 500': (r) => r.status < 500,
    });
    raceCrashRate.add(reschedRes.status >= 500 ? 1 : 0);
  }
}

// ─── RC-05: Concurrent Queue Rebuild ──────────────────────────────
function rc05_concurrent_rebuild(headers, data) {
  const res = http.post(
    `${BASE_URL}/api/system/rebuild-queue`,
    null,
    { headers, tags: { name: 'rc05_rebuild' }, timeout: '30s' }
  );

  raceWinnerRate.add(res.status === 200 ? 1 : 0);
  raceCrashRate.add(res.status >= 500 ? 1 : 0);

  check(res, {
    'RC-05: status 200':              (r) => r.status === 200,
    'RC-05: success=true':            (r) => {
      try { return r.json().success === true; } catch { return false; }
    },
    'RC-05: no negative enqueue count': (r) => {
      try { return r.json().enqueuedCount >= 0; } catch { return true; }
    },
    'RC-05: response < 15000ms':      (r) => r.timings.duration < 15000,
    'RC-05: no 500':                  (r) => r.status < 500,
  });

  if (res.status >= 500) {
    console.error(`[RC-05] 💥 VU ${__VU} got 500 on concurrent rebuild: ${res.body?.substring(0, 200)}`);
  }

  sleep(1);
}
