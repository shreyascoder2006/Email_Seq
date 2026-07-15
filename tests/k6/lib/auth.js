/**
 * tests/k6/lib/auth.js
 *
 * Shared authentication helper for all k6 test scenarios.
 * Handles JWT login and per-VU token caching.
 *
 * Usage:
 *   import { getToken, authHeaders } from './lib/auth.js';
 *   const token = getToken();
 *   const res   = http.get(`${BASE_URL}/api/sequences`, { headers: authHeaders(token) });
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

// ─── Configuration ──────────────────────────────────────────────────
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';

// Multi-user pool: VU_INDEX selects the user slot (round-robin)
const USERS = [
  { email: __ENV.USER1_EMAIL || 'test1@example.com', password: __ENV.USER1_PASS || 'password123' },
  { email: __ENV.USER2_EMAIL || 'test2@example.com', password: __ENV.USER2_PASS || 'password123' },
  { email: __ENV.USER3_EMAIL || 'test3@example.com', password: __ENV.USER3_PASS || 'password123' },
];

// Per-VU token cache (k6 VUs are goroutine-like, so this is per-VU state)
let _cachedToken = null;
let _cachedUserId = null;

/**
 * Authenticate and cache the JWT for this VU.
 * Call once in the k6 `setup()` phase or at the start of each VU's init.
 *
 * @param {number} userIndex - 0-based index into USERS array (default: VU index mod pool size)
 * @returns {{ token: string, userId: string }}
 */
export function login(userIndex = null) {
  const idx    = userIndex !== null ? userIndex : (__VU - 1) % USERS.length;
  const user   = USERS[idx] || USERS[0];

  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: user.email, password: user.password }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags:    { name: 'auth_login' },
    }
  );

  const ok = check(res, {
    'login: status 200':         (r) => r.status === 200,
    'login: token present':      (r) => !!r.json('data.token'),
  });

  if (!ok || res.status !== 200) {
    console.error(`[VU ${__VU}] Login failed for ${user.email}: ${res.status} — ${res.body}`);
    return { token: null, userId: null };
  }

  const body    = res.json();
  const token   = body.data?.token || body.token;
  const userId  = body.data?.userId || body.data?.user?._id || body.userId;

  _cachedToken  = token;
  _cachedUserId = userId;

  return { token, userId };
}

/**
 * Return the cached token for this VU, logging in if needed.
 */
export function getToken(userIndex = null) {
  if (_cachedToken) return _cachedToken;
  const { token } = login(userIndex);
  return token;
}

/**
 * Build the Authorization header object.
 */
export function authHeaders(token, extra = {}) {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${token}`,
    ...extra,
  };
}

/**
 * Run login for all users in setup() and return an array of tokens.
 * Use this in scenarios that need pre-loaded tokens.
 */
export function loginAllUsers() {
  return USERS.map((user, i) => {
    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: user.email, password: user.password }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (res.status !== 200) {
      console.warn(`[setup] Could not login user ${i} (${user.email}): ${res.status}`);
      return { token: null, userId: null, email: user.email };
    }
    const body = res.json();
    return {
      token:  body.data?.token || body.token,
      userId: body.data?.userId || body.data?.user?._id,
      email:  user.email,
    };
  });
}
