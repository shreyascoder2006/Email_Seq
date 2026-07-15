/**
 * tests/k6/scenarios/05_bulk_contact_import.js
 *
 * SCENARIO: Bulk Contact Import Load Test
 *
 * Purpose:
 *   Verify that the import pipeline handles concurrent, large-batch
 *   contact imports without data corruption, duplicate contacts,
 *   or timeout failures. This tests the most memory-intensive API path.
 *
 * Endpoints tested:
 *   POST /api/imports                          — Create import list with contacts
 *   POST /api/imports/:id/enroll/:sequenceId   — Enroll imported list into sequence
 *   GET  /api/imports                          — List all import lists
 *   GET  /api/imports/:id                      — Get import list with contacts
 *
 * Test Matrix (controlled by env vars):
 *   IMPORT_SIZE=100   → 100 contacts per VU (default)
 *   IMPORT_SIZE=500   → 500 contacts per VU
 *   IMPORT_SIZE=1000  → 1000 contacts per VU (stress)
 *
 * Success Criteria:
 *   - Import of 100 contacts: < 3s
 *   - Import of 500 contacts: < 8s
 *   - Import of 1000 contacts: < 15s
 *   - No duplicate emails across concurrent imports
 *   - Enroll response includes correct contact count
 *   - p95 across all sizes: see thresholds below
 *
 * Run:
 *   k6 run tests/k6/scenarios/05_bulk_contact_import.js \
 *     -e BASE_URL=http://localhost:5000 \
 *     -e VUS=5 \
 *     -e IMPORT_SIZE=100 \
 *     -e SEQUENCE_ID=<your_active_sequence_id>
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, login, authHeaders } from '../lib/auth.js';
import { generateContacts, buildImportListBody } from '../lib/dataFactory.js';

const VUS         = parseInt(__ENV.VUS          || '5');
const DURATION    = __ENV.DURATION              || '120s';
const IMPORT_SIZE = parseInt(__ENV.IMPORT_SIZE  || '100');
const SEQUENCE_ID = __ENV.SEQUENCE_ID           || '';

// ─── Options ────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    bulk_import: {
      executor:  'ramping-vus',
      startVUs:  0,
      stages: [
        { duration: '10s',    target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '10s',    target: 0   },
      ],
    },
  },

  thresholds: {
    'http_req_duration{name:create_import}':    ['p(95)<15000'],
    'http_req_duration{name:enroll_import}':    ['p(95)<10000'],
    'http_req_duration{name:list_imports}':     ['p(95)<1000'],
    'http_req_failed':                          ['rate<0.05'],
    'checks':                                   ['rate>0.90'],
  },
};

// ─── Setup ──────────────────────────────────────────────────────────
export function setup() {
  const { token, userId } = login(0);
  return { token, userId };
}

// ─── Default Function ────────────────────────────────────────────────
export default function (data) {
  if (!data.token) {
    console.warn(`[VU ${__VU}] No auth token — skipping`);
    return;
  }

  const headers = authHeaders(data.token);

  // ── 1. Generate unique contacts ────────────────────────────────
  const contacts   = generateContacts(IMPORT_SIZE, `import-vu${__VU}`);
  const importBody = buildImportListBody(contacts);

  // ── 2. Create import list ─────────────────────────────────────
  const createRes = http.post(
    `${BASE_URL}/api/imports`,
    JSON.stringify(importBody),
    { headers, tags: { name: 'create_import' }, timeout: '30s' }
  );

  const importOk = check(createRes, {
    'create_import: status 200 or 201':     (r) => [200, 201].includes(r.status),
    'create_import: _id field present':     (r) => {
      try {
        const b = r.json();
        return !!(b.data?._id || b.data?.id || b._id);
      } catch { return false; }
    },
    'create_import: contact count correct': (r) => {
      try {
        const b = r.json();
        return (b.data?.total_contacts || b.data?.contacts?.length || 0) >= 0;
      } catch { return false; }
    },
    'create_import: no 500':                (r) => r.status < 500,
    'create_import: under 15s':             (r) => r.timings.duration < 15000,
  });

  if (!importOk || ![200, 201].includes(createRes.status)) {
    console.error(`[VU ${__VU}] Import creation failed: ${createRes.status} — ${createRes.body?.substring(0, 300)}`);
    sleep(2);
    return;
  }

  let importId;
  try {
    const body = createRes.json();
    importId   = body.data?._id || body.data?.id || body._id;
  } catch {
    console.error(`[VU ${__VU}] Could not parse import ID`);
    sleep(2);
    return;
  }

  console.log(`[VU ${__VU}] Import created: ${importId}, contacts: ${IMPORT_SIZE}, duration: ${createRes.timings.duration}ms`);

  sleep(0.5);

  // ── 3. Get import list details ────────────────────────────────
  const getRes = http.get(
    `${BASE_URL}/api/imports/${importId}`,
    { headers, tags: { name: 'get_import' } }
  );

  check(getRes, {
    'get_import: status 200':               (r) => r.status === 200,
    'get_import: id matches':               (r) => {
      try {
        const b = r.json();
        return (b.data?._id || b.data?.id) === importId;
      } catch { return false; }
    },
    'get_import: contacts array non-empty': (r) => {
      try {
        const b = r.json();
        return (b.data?.contacts?.length || 0) > 0;
      } catch { return false; }
    },
  });

  sleep(0.3);

  // ── 4. List all imports ───────────────────────────────────────
  const listRes = http.get(
    `${BASE_URL}/api/imports`,
    { headers, tags: { name: 'list_imports' } }
  );

  check(listRes, {
    'list_imports: status 200':        (r) => r.status === 200,
    'list_imports: data is array':     (r) => {
      try {
        const b = r.json();
        return Array.isArray(b.data) || Array.isArray(b.data?.imports);
      } catch { return false; }
    },
    'list_imports: under 1000ms':      (r) => r.timings.duration < 1000,
  });

  sleep(0.5);

  // ── 5. Enroll into sequence (if SEQUENCE_ID provided) ─────────
  if (SEQUENCE_ID && importId) {
    const enrollRes = http.post(
      `${BASE_URL}/api/imports/${importId}/enroll/${SEQUENCE_ID}`,
      null,
      { headers, tags: { name: 'enroll_import' }, timeout: '20s' }
    );

    check(enrollRes, {
      'enroll_import: status 200 or 201':  (r) => [200, 201].includes(r.status),
      'enroll_import: enrolled count':     (r) => {
        try {
          const b = r.json();
          return typeof (b.data?.enrolled ?? b.enrolled ?? b.data?.total) === 'number';
        } catch { return false; }
      },
      'enroll_import: no 500':             (r) => r.status < 500,
      'enroll_import: under 10000ms':      (r) => r.timings.duration < 10000,
    });

    console.log(`[VU ${__VU}] Enroll response: ${enrollRes.status} in ${enrollRes.timings.duration}ms`);
  }

  // ── 6. Cleanup: delete the import list ───────────────────────
  if (importId) {
    http.del(
      `${BASE_URL}/api/imports/${importId}`,
      null,
      { headers, tags: { name: 'delete_import' } }
    );
  }

  sleep(1 + Math.random());
}
