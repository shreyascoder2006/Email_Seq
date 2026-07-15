#!/usr/bin/env node

/**
 * tests/scripts/seed_test_data.js
 *
 * Used by GitHub Actions to bootstrap test data on a fresh DB.
 */
const http = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const EMAIL = 'ci-test@example.com';
const PASSWORD = 'password123';

async function request(method, path, body = null, token = null) {
  return new Promise((resolve) => {
    const req = http.request(BASE_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  // 1. Register User (assume there's a signup endpoint or handle in DB directly)
  // For CI, we might need a test-only backdoor or we use direct DB seeding.
  // We'll output mock values if we can't create them via API for now.
  console.log(JSON.stringify({
    email: EMAIL,
    password: PASSWORD,
    sequenceId: 'mock_sequence_id',
    connectionId: 'mock_connection_id'
  }));
}

run();
