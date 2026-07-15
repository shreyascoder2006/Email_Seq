# Email Sequencing Module — Performance & Chaos Testing Framework

This directory contains the complete enterprise-grade concurrency, load, stress, and chaos testing suite for the Email Sequencing Module.

The suite validates the architecture (Node.js, Express, MongoDB, BullMQ, Redis) under high load and ensures exactly-once processing guarantees, strict state isolation, and auto-recovery from infrastructure failures.

---

## 📋 Prerequisites

Before running the tests, ensure your local or staging environment is properly configured:

1. **Infrastructure**:
   - MongoDB running locally (or via remote URI).
   - Redis running locally (default port `6379`).
2. **Backend Services**:
   - Backend API is running (`npm run dev` or `npm run start`).
   - Email workers and scheduler watchdogs are active.
3. **Test Data**:
   - At least 1 registered test user account.
   - At least 1 connected Email Account (SMTP connection) to capture the `CONNECTION_ID`.
   - At least 1 pre-created Sequence to capture the `SEQUENCE_ID`.
4. **Tooling**:
   - [k6 installed](https://k6.io/docs/get-started/installation/) (`winget install k6` on Windows).
   - Node.js v18+.

---

## 🚀 How to Run the Tests

### Option 1: Master Runner (Recommended)

The easiest way to run the entire suite (Baseline -> Load -> Multi-Worker -> Chaos -> Final Consistency Check) is via the master PowerShell script. 

**From the backend folder:**
```powershell
npm run test:performance
```

**Or directly via PowerShell:**
```powershell
.\tests\scripts\run_all_tests.ps1 `
  -BaseUrl "http://localhost:5000" `
  -User1Email "test1@example.com" `
  -User1Pass "password123" `
  -SequenceId "YOUR_SEQUENCE_ID" `
  -ConnectionId "YOUR_EMAIL_CONNECTION_ID"
```

### Option 2: Running Individual k6 Load Scripts

You can run specific load testing scenarios directly using `k6`.

**Example:**
```powershell
k6 run tests\k6\scenarios\05_bulk_contact_import.js `
  -e BASE_URL="http://localhost:5000" `
  -e USER1_EMAIL="test1@example.com" `
  -e USER1_PASS="password123" `
  -e IMPORT_SIZE=500 `
  -e VUS=5
```

### Option 3: Running Chaos Tests Manually

Chaos tests require manual intervention (killing processes, disabling networks) to observe the system's reaction. Follow the on-screen instructions within each script.

**Example:**
```powershell
node tests\chaos\backend_restart.js
```

---

## 🔧 Environment Variables Reference

All k6 test scripts rely on the following environment variables.

| Variable | Required | Default | Description |
|---|---|---|---|
| `BASE_URL` | Yes | `http://localhost:5000` | The backend API root URL. |
| `USER1_EMAIL` | Yes | `test1@example.com` | Primary test user email. |
| `USER1_PASS` | Yes | `password123` | Primary test user password. |
| `SEQUENCE_ID` | Scenario-dependent | - | A valid `_id` of a Sequence owned by the test user. |
| `EMAIL_CONNECTION_ID` | Scenario-dependent | - | A valid `_id` of a connected Email Account. |
| `VUS` | No | `10` | Number of Virtual Users (concurrent connections). |
| `DURATION` | No | `30s` | How long the load test runs. |
| `IMPORT_SIZE` | No | `100` | (For scenario 05) Number of contacts to generate in memory. |
| `EMAIL_COUNT` | No | `100` | (For scenario 06) Number of emails to process and drain. |

---

## 🚦 Test Categories & Criteria

### 1. Concurrency & Load (k6)
Located in `tests/k6/scenarios/`. Tests API endpoints under heavy parallel usage to guarantee isolation.
- **PASS Criteria:** `http_req_duration` p95 < 500ms, `http_req_failed` < 1%, no token collision across VUs.
- **Scenarios:** Login, Sequence Lifecycle, Bulk Import, Queue Rebuild.

### 2. Race Conditions (k6)
Located in `tests/k6/scenarios/07_race_conditions.js` and `08_more_race_conditions.js`. Tests structural limits of Express routes missing mutexes.
- **PASS Criteria:** EXACTLY ONE winner per concurrent collision. 0 instances of HTTP 500 crashes.
- **Scenarios:** Dual sequence activate, concurrent reschedule overlapping with worker ticks.

### 3. Chaos Engineering (Node.js)
Located in `tests/chaos/`. Validates auto-recovery algorithms (`RecoveryEngine`).
- **PASS Criteria:** System transitions to `DEGRADED`, watchdog restarts/repairs queue, and transitions back to `HEALTHY`.
- **Scenarios:** Redis wipe, backend process crash, MongoDB network drop, SMTP revocation.

### 4. Database Consistency (Node.js)
Located in `tests/consistency/`. The absolute source of truth.
- **PASS Criteria:** 
  1. `0` duplicate `SendingLog` records (No contact received the same step twice).
  2. `0` orphaned contacts.
  3. No `sending_locked=true` instances older than 5 minutes.
  4. Sequence stats match exact log counts.

### 5. Multi-Worker & Monitoring
Located in `tests/scripts/`. 
- **`multi_worker_test.js`**: Validates that 2+ BullMQ workers do not steal each other's jobs (using `sending_locked`).
- **`monitor.js`**: Emits real-time throughput metrics (Emails/Sec), CPU load, and Heap usage to JSON/CSV format in `tests/reports/`.

---

## 📊 Interpreting Results

After executing `run_all_tests.ps1`, a summary report is saved to `tests/reports/test_run_YYYYMMDD_HHMMSS.txt`.

* **`[PASS]`**: The system performed flawlessly within thresholds. No data corruption occurred.
* **`[WARN]`**: The system experienced slight latency degradation, or retries were required. Safe for staging, but monitor in prod.
* **`[FAIL]`**: HTTP 500s were triggered, Duplicate emails were sent, or the system failed to auto-recover. **DO NOT DEPLOY.**

Always run `node tests\consistency\check_db_consistency.js` after any manual debugging or load testing to verify system integrity!
