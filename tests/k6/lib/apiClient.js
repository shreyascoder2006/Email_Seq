/**
 * tests/k6/lib/apiClient.js
 *
 * Reusable HTTP API client for k6 testing.
 * Centralizes endpoint calls to reduce boilerplate in scenarios.
 */
import http from 'k6/http';
import { BASE_URL, authHeaders } from './auth.js';

export const ApiClient = {
  /**
   * Sequence Management
   */
  createSequence(token, payload, tags = {}) {
    return http.post(`${BASE_URL}/api/sequences`, JSON.stringify(payload), {
      headers: authHeaders(token),
      tags: { name: 'create_sequence', ...tags },
    });
  },

  updateSequenceStatus(token, sequenceId, status, tags = {}) {
    return http.patch(`${BASE_URL}/api/sequences/${sequenceId}/status`, JSON.stringify({ status }), {
      headers: authHeaders(token),
      tags: { name: 'update_sequence_status', ...tags },
    });
  },

  deleteSequence(token, sequenceId, tags = {}) {
    return http.del(`${BASE_URL}/api/sequences/${sequenceId}`, null, {
      headers: authHeaders(token),
      tags: { name: 'delete_sequence', ...tags },
    });
  },

  enrollContacts(token, sequenceId, contactsPayload, tags = {}) {
    return http.post(`${BASE_URL}/api/sequences/${sequenceId}/enroll`, JSON.stringify(contactsPayload), {
      headers: authHeaders(token),
      tags: { name: 'enroll_contacts', ...tags },
    });
  },

  rescheduleContacts(token, sequenceId, payload, tags = {}) {
    return http.post(`${BASE_URL}/api/sequences/${sequenceId}/reschedule`, JSON.stringify(payload), {
      headers: authHeaders(token),
      tags: { name: 'reschedule_contacts', ...tags },
    });
  },

  getSequenceContacts(token, sequenceId, status = 'active', limit = 10, tags = {}) {
    return http.get(`${BASE_URL}/api/sequences/${sequenceId}/contacts?status=${status}&limit=${limit}`, {
      headers: authHeaders(token),
      tags: { name: 'get_sequence_contacts', ...tags },
    });
  },

  /**
   * System Endpoints
   */
  rebuildQueue(token, tags = {}) {
    return http.post(`${BASE_URL}/api/system/rebuild-queue`, null, {
      headers: authHeaders(token),
      tags: { name: 'rebuild_queue', ...tags },
      timeout: '30s',
    });
  },

  getSystemHealth(token, tags = {}) {
    return http.get(`${BASE_URL}/api/system/health`, {
      headers: authHeaders(token),
      tags: { name: 'get_system_health', ...tags },
    });
  },

  getSystemWorkers(token, tags = {}) {
    return http.get(`${BASE_URL}/api/system/workers`, {
      headers: authHeaders(token),
      tags: { name: 'get_system_workers', ...tags },
    });
  },

  /**
   * Imports
   */
  createImport(token, payload, tags = {}) {
    return http.post(`${BASE_URL}/api/imports`, JSON.stringify(payload), {
      headers: authHeaders(token),
      tags: { name: 'create_import', ...tags },
      timeout: '30s',
    });
  },

  getImport(token, importId, tags = {}) {
    return http.get(`${BASE_URL}/api/imports/${importId}`, {
      headers: authHeaders(token),
      tags: { name: 'get_import', ...tags },
    });
  },

  listImports(token, tags = {}) {
    return http.get(`${BASE_URL}/api/imports`, {
      headers: authHeaders(token),
      tags: { name: 'list_imports', ...tags },
    });
  },

  enrollImport(token, importId, sequenceId, tags = {}) {
    return http.post(`${BASE_URL}/api/imports/${importId}/enroll/${sequenceId}`, null, {
      headers: authHeaders(token),
      tags: { name: 'enroll_import', ...tags },
      timeout: '30s',
    });
  },

  deleteImport(token, importId, tags = {}) {
    return http.del(`${BASE_URL}/api/imports/${importId}`, null, {
      headers: authHeaders(token),
      tags: { name: 'delete_import', ...tags },
    });
  }
};
