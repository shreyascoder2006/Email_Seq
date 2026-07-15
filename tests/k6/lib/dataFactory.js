/**
 * tests/k6/lib/data.js
 *
 * Test data factory functions for all k6 scenarios.
 * Generates realistic, unique contact and sequence data per VU iteration.
 */

import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ─── Contact Generator ──────────────────────────────────────────────

/**
 * Generate a batch of unique contacts for enrollment.
 *
 * @param {number} count   - Number of contacts to generate
 * @param {string} prefix  - Optional email prefix for traceability
 * @returns {Array<object>}
 */
export function generateContacts(count, prefix = 'load') {
  const contacts = [];
  const ts = Date.now();
  for (let i = 0; i < count; i++) {
    const uid = `${prefix}-${ts}-vu${__VU}-iter${__ITER}-${i}`;
    contacts.push({
      email:      `${uid}@loadtest.invalid`,
      first_name: `Load`,
      last_name:  `Tester${i}`,
      company:    `Company${i % 20}`,
      custom_variables: {
        pain_point: `challenge_${i % 5}`,
        use_case:   `scenario_${i % 3}`,
      },
    });
  }
  return contacts;
}

/**
 * Generate a CSV string for bulk import tests.
 *
 * @param {number} rows - Number of rows
 * @param {string} prefix
 * @returns {string}
 */
export function generateCsv(rows, prefix = 'csv') {
  const ts = Date.now();
  let csv = 'email,first_name,last_name,company\n';
  for (let i = 0; i < rows; i++) {
    const uid = `${prefix}-${ts}-vu${__VU}-iter${__ITER}-${i}`;
    csv += `${uid}@csvtest.invalid,CsvFirst${i},CsvLast${i},CsvCo${i % 10}\n`;
  }
  return csv;
}

/**
 * Build a CreateImportList body from raw contacts array.
 */
export function buildImportListBody(contacts, listName = null) {
  const ts = Date.now();
  return {
    name: listName || `Load Test Import ${ts} VU${__VU} ITER${__ITER}`,
    field_mappings: {
      email:      'email',
      first_name: 'first_name',
      last_name:  'last_name',
      company:    'company',
    },
    contacts: contacts.map(c => ({
      email:      c.email,
      first_name: c.first_name,
      last_name:  c.last_name,
      company:    c.company || '',
    })),
  };
}

/**
 * Build a CreateSequence body.
 *
 * @param {string} emailConnectionId - Valid EmailConnection _id from DB
 */
export function buildSequenceBody(emailConnectionId, name = null) {
  const ts = Date.now();
  return {
    name:                name || `Load Test Seq ${ts} VU${__VU}`,
    email_connection_id: emailConnectionId,
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
    track_clicks:  true,
  };
}

/**
 * Build a RescheduleCampaign body.
 *
 * @param {string[]} contactIds  - Array of SequenceContact _ids
 * @param {string}   action      - 'immediately' | 'today' | 'tomorrow' | 'custom'
 */
export function buildRescheduleBody(contactIds, action = 'immediately') {
  return {
    contact_ids:      contactIds,
    action,
    browser_timezone: 'Asia/Kolkata',
    ...(action === 'custom' ? {
      start_hour:   9,
      start_minute: 0,
      end_hour:     18,
      end_minute:   0,
      launch_date:  new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    } : {}),
  };
}

/**
 * Build an EnrollContacts body from a contact array.
 */
export function buildEnrollBody(contacts) {
  return {
    contacts: contacts.map(c => ({
      email:      c.email,
      first_name: c.first_name,
      last_name:  c.last_name  || '',
      company:    c.company    || '',
      custom_variables: c.custom_variables || {},
    })),
  };
}

// ─── Scenario Metadata ──────────────────────────────────────────────

/**
 * Pick a random element from an array.
 */
export function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a unique correlation ID for tracing a request through logs.
 */
export function correlationId() {
  return `k6-${__VU}-${__ITER}-${Date.now()}`;
}
