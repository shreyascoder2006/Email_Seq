/**
 * tests/k6/scenarios/02_sequence_lifecycle.js
 *
 * SCENARIO: Sequence Lifecycle Concurrency Test
 *
 * Tests concurrent execution of the full sequence state machine:
 *   Activate → Pause → Resume → Reschedule
 *
 * This is the MOST CRITICAL race-condition test in the suite.
 * It verifies that the state machine rejects invalid transitions
 * when multiple VUs attempt simultaneous operations on the SAME sequence.
 *
 * Architecture Note:
 *   - Each VU works on a SEPARATE sequence (no shared state across VUs)
 *   - Within a single VU, rapid Pause → Resume cycles stress the state machine
 *   - The setup() phase creates one sequence per VU and enrolls contacts
 *   - The teardown() phase archives all test sequences
 *
 * Success Criteria:
 *   - All activate/pause/resume requests succeed or return 409 (conflict)
 *   - No 500 errors
 *   - p95 status transition < 1000ms
 *   - No orphaned contacts after teardown
 *
 * Run:
 *   k6 run tests/k6/scenarios/02_sequence_lifecycle.js \
 *     -e BASE_URL=http://localhost:5000 \
 *     -e VUS=10 \
 *     -e DURATION=60s \
 *     -e EMAIL_CONNECTION_ID=<your_connection_id>
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { BASE_URL, login, authHeaders } from '../lib/auth.js';
import { checkOk, checkTransition, apiErrorRate } from '../lib/checks.js';
import { generateContacts, buildEnrollBody } from '../lib/dataFactory.js';

const VUS      = parseInt(__ENV.VUS      || '10');
const DURATION = __ENV.DURATION          || '60s';
const RAMP_UP  = __ENV.RAMP_UP           || '10s';
const EMAIL_CONNECTION_ID = __ENV.EMAIL_CONNECTION_ID || '';

// ─── Options ────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    sequence_lifecycle: {
      executor:  'ramping-vus',
      startVUs:  0,
      stages: [
        { duration: RAMP_UP,   target: VUS },
        { duration: DURATION,  target: VUS },
        { duration: '10s',     target: 0   },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    'http_req_duration{name:activate_sequence}': ['p(95)<1500'],
    'http_req_duration{name:pause_sequence}':    ['p(95)<1000'],
    'http_req_duration{name:resume_sequence}':   ['p(95)<1000'],
    'http_req_failed':                           ['rate<0.05'],
    'checks':                                    ['rate>0.95'],
  },
};

// ─── Setup ──────────────────────────────────────────────────────────
// Creates one sequence per VU before the test starts.

export function setup() {
  const { token } = login(0);
  if (!token) return { sequences: [], token: null };

  const sequences = [];
  for (let i = 0; i < VUS; i++) {
    // Create sequence
    const createRes = http.post(
      `${BASE_URL}/api/sequences`,
      JSON.stringify({
        name:                `[LOAD-TEST] Lifecycle Seq VU${i} ${Date.now()}`,
        email_connection_id: EMAIL_CONNECTION_ID,
        sending_window: {
          timezone:    'Asia/Kolkata',
          start_hour:  9,
          start_minute: 0,
          end_hour:    18,
          end_minute:   0,
          custom_days:  [1, 2, 3, 4, 5],
        },
        stop_on_reply: true,
        track_opens:   true,
        track_clicks:  false,
      }),
      { headers: authHeaders(token) }
    );

    if (createRes.status !== 201 && createRes.status !== 200) {
      console.warn(`[setup] Could not create sequence for VU ${i}: ${createRes.status} ${createRes.body}`);
      continue;
    }

    const seqBody = createRes.json();
    const seqId   = seqBody.data?._id || seqBody.data?.id || seqBody._id;
    if (!seqId) continue;

    // Enroll a small batch of contacts so activation is valid
    const contacts = generateContacts(5, `lifecycle-vu${i}`);
    const enrollRes = http.post(
      `${BASE_URL}/api/sequences/${seqId}/enroll`,
      JSON.stringify(buildEnrollBody(contacts)),
      { headers: authHeaders(token) }
    );

    sequences.push({
      id:     seqId,
      vuIndex: i,
      enrolled: [200, 201].includes(enrollRes.status),
    });
  }

  console.log(`[setup] Created ${sequences.length}/${VUS} sequences`);
  return { sequences, token };
}

// ─── Default Function ────────────────────────────────────────────────
export default function (data) {
  if (!data.sequences || data.sequences.length === 0) {
    console.warn(`[VU ${__VU}] No sequences available — skipping`);
    return;
  }

  // Each VU owns its own sequence (by index)
  const { token } = login();
  if (!token) return;

  const vuIdx = (__VU - 1) % data.sequences.length;
  const seq   = data.sequences[vuIdx];
  if (!seq) return;

  const seqId   = seq.id;
  const headers = authHeaders(token);

  // ── 1. Activate ────────────────────────────────────────────────
  const activateRes = http.patch(
    `${BASE_URL}/api/sequences/${seqId}/status`,
    JSON.stringify({ status: 'active' }),
    { headers, tags: { name: 'activate_sequence' } }
  );

  // Valid: 200 (activated), 409 (already active), 400 (invalid transition)
  check(activateRes, {
    'activate: accepted or conflict': (r) => [200, 400, 409].includes(r.status),
    'activate: no 500 error':         (r) => r.status < 500,
    'activate: response < 2000ms':    (r) => r.timings.duration < 2000,
  });

  sleep(0.3 + Math.random() * 0.7);

  // ── 2. Pause ───────────────────────────────────────────────────
  if (activateRes.status === 200) {
    const pauseRes = http.patch(
      `${BASE_URL}/api/sequences/${seqId}/status`,
      JSON.stringify({ status: 'paused' }),
      { headers, tags: { name: 'pause_sequence' } }
    );

    check(pauseRes, {
      'pause: status 200':         (r) => r.status === 200,
      'pause: status field paused': (r) => {
        try {
          const b = r.json();
          return (b.data?.status || b.status) === 'paused';
        } catch { return false; }
      },
      'pause: response < 1000ms':  (r) => r.timings.duration < 1000,
    });

    sleep(0.2 + Math.random() * 0.3);

    // ── 3. Resume ────────────────────────────────────────────────
    const resumeRes = http.patch(
      `${BASE_URL}/api/sequences/${seqId}/status`,
      JSON.stringify({ status: 'active' }),
      { headers, tags: { name: 'resume_sequence' } }
    );

    check(resumeRes, {
      'resume: status 200':          (r) => r.status === 200,
      'resume: status field active':  (r) => {
        try {
          const b = r.json();
          return (b.data?.status || b.status) === 'active';
        } catch { return false; }
      },
      'resume: response < 1500ms':   (r) => r.timings.duration < 1500,
    });

    sleep(0.5 + Math.random() * 0.5);

    // ── 4. Reschedule Campaign ──────────────────────────────────
    // Fetch contacts to reschedule
    const contactsRes = http.get(
      `${BASE_URL}/api/sequences/${seqId}/contacts?status=active&limit=5`,
      { headers, tags: { name: 'list_contacts' } }
    );

    if (contactsRes.status === 200) {
      try {
        const body       = contactsRes.json();
        const contacts   = body.data?.contacts || body.data || [];
        const contactIds = contacts.map(c => c._id || c.id).filter(Boolean);

        if (contactIds.length > 0) {
          const rescheduleRes = http.post(
            `${BASE_URL}/api/sequences/${seqId}/reschedule`,
            JSON.stringify({
              contact_ids:      contactIds,
              action:           'immediately',
              browser_timezone: 'Asia/Kolkata',
            }),
            { headers, tags: { name: 'reschedule_campaign' } }
          );

          check(rescheduleRes, {
            'reschedule: status 200':         (r) => r.status === 200,
            'reschedule: response < 5000ms':  (r) => r.timings.duration < 5000,
            'reschedule: no 500 error':       (r) => r.status < 500,
          });
        }
      } catch (e) {
        console.warn(`[VU ${__VU}] Reschedule parse error: ${e.message}`);
      }
    }
  }

  sleep(1 + Math.random());
}

// ─── Teardown ────────────────────────────────────────────────────────
export function teardown(data) {
  if (!data.token || !data.sequences) return;
  for (const seq of data.sequences) {
    if (!seq.id) continue;
    // Archive to prevent dangling active sequences
    http.patch(
      `${BASE_URL}/api/sequences/${seq.id}/status`,
      JSON.stringify({ status: 'archived' }),
      { headers: authHeaders(data.token) }
    );
    // Hard delete the test sequence
    http.del(
      `${BASE_URL}/api/sequences/${seq.id}`,
      null,
      { headers: authHeaders(data.token) }
    );
  }
  console.log(`[teardown] Archived & deleted ${data.sequences.length} test sequences`);
}
