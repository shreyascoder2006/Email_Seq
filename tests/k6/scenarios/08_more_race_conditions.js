/**
 * tests/k6/scenarios/08_more_race_conditions.js
 *
 * SCENARIO: Additional Race Condition Tests
 *
 * Tests:
 *   RC-06: Worker processing while paused
 *   RC-07: Concurrent bulk imports
 *   RC-08: Concurrent template updates
 *
 * Run:
 *   k6 run tests/k6/scenarios/08_more_race_conditions.js \
 *     -e BASE_URL=http://localhost:5000 \
 *     -e SEQUENCE_ID=<your_sequence_id>
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, login, authHeaders } from '../lib/auth.js';
import { ApiClient } from '../lib/apiClient.js';
import { generateContacts, buildImportListBody } from '../lib/dataFactory.js';
import { raceWinnerRate, raceCrashRate } from '../lib/metrics.js';

const SEQUENCE_ID = __ENV.SEQUENCE_ID || '';

export const options = {
  scenarios: {
    // RC-06 is hard to simulate directly via API without a worker stub.
    // We will simulate the API side: rapidly pausing and enrolling.
    rc06_pause_while_enrolling: {
      executor: 'shared-iterations',
      vus: 5,
      iterations: 10,
      maxDuration: '30s',
      env: { RC_SCENARIO: 'rc06' },
    },
    // RC-07: Concurrent bulk imports
    rc07_concurrent_imports: {
      executor: 'shared-iterations',
      vus: 5,
      iterations: 5,
      maxDuration: '45s',
      startTime: '35s',
      env: { RC_SCENARIO: 'rc07' },
    },
    // RC-08: Concurrent template updates
    rc08_concurrent_template_updates: {
      executor: 'shared-iterations',
      vus: 10,
      iterations: 20,
      maxDuration: '30s',
      startTime: '85s',
      env: { RC_SCENARIO: 'rc08' },
    },
  },
  thresholds: {
    'race_crash_5xx': ['rate<0.001'],
    'http_req_failed': ['rate<0.1'],
  },
};

export function setup() {
  const { token } = login(0);
  return { token };
}

export default function (data) {
  if (!data.token) return;

  const scenario = __ENV.RC_SCENARIO;
  const headers = authHeaders(data.token);

  switch (scenario) {
    case 'rc06': rc06_pause_while_enrolling(data.token, headers); break;
    case 'rc07': rc07_concurrent_imports(data.token, headers); break;
    case 'rc08': rc08_concurrent_template_updates(data.token, headers); break;
  }
}

function rc06_pause_while_enrolling(token, headers) {
  if (!SEQUENCE_ID) return;

  if (__VU % 2 === 0) {
    const contacts = generateContacts(5, `rc06-enroll`);
    const res = ApiClient.enrollContacts(token, SEQUENCE_ID, { contacts });
    raceCrashRate.add(res.status >= 500 ? 1 : 0);
  } else {
    const status = Math.random() > 0.5 ? 'paused' : 'active';
    const res = ApiClient.updateSequenceStatus(token, SEQUENCE_ID, status);
    raceCrashRate.add(res.status >= 500 ? 1 : 0);
  }
  sleep(0.5);
}

function rc07_concurrent_imports(token, headers) {
  const contacts = generateContacts(200, `rc07-import-${__VU}`);
  const payload = buildImportListBody(contacts);
  
  const res = ApiClient.createImport(token, payload);
  raceWinnerRate.add(res.status === 200 || res.status === 201 ? 1 : 0);
  raceCrashRate.add(res.status >= 500 ? 1 : 0);

  check(res, {
    'RC-07: no 500 crash': (r) => r.status < 500,
    'RC-07: import created': (r) => [200, 201].includes(r.status),
  });
  sleep(1);
}

function rc08_concurrent_template_updates(token, headers) {
  if (!SEQUENCE_ID) return;

  // We patch the sequence to update a step template simultaneously
  const payload = {
    steps: [
      {
        delay_days: 1,
        template: {
          subject: `Concurrent Subject ${Date.now()}`,
          body_html: `<p>Concurrent body ${Date.now()} VU${__VU}</p>`
        }
      }
    ]
  };

  const res = http.patch(
    `${BASE_URL}/api/sequences/${SEQUENCE_ID}`,
    JSON.stringify(payload),
    { headers, tags: { name: 'rc08_update_template' } }
  );

  raceWinnerRate.add(res.status === 200 ? 1 : 0);
  raceCrashRate.add(res.status >= 500 ? 1 : 0);

  check(res, {
    'RC-08: no 500 crash': (r) => r.status < 500,
  });
}
