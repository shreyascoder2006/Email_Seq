# ============================================================
# tests/scripts/run_all_tests.ps1
# 
# Master Test Runner — PowerShell Script (Windows)
#
# Purpose:
#   Orchestrate the full concurrency, load, stress, and chaos 
#   test suite in sequence with consistent reporting.
#
# Prerequisites:
#   - k6 installed: https://k6.io/docs/get-started/installation/
#   - Node.js 18+
#   - MongoDB running
#   - Redis running
#   - Backend running on $BASE_URL
#   - At least one active sequence with contacts enrolled
#
# Usage:
#   .\tests\scripts\run_all_tests.ps1 `
#     -BaseUrl "http://localhost:5000" `
#     -User1Email "test1@example.com" `
#     -User1Pass "password123" `
#     -SequenceId "YOUR_SEQUENCE_ID" `
#     -ConnectionId "YOUR_EMAIL_CONNECTION_ID"
#
# ============================================================

param(
  [string]$BaseUrl     = "http://localhost:5000",
  [string]$User1Email  = "test1@example.com",
  [string]$User1Pass   = "password123",
  [string]$User2Email  = "test2@example.com",
  [string]$User2Pass   = "password123",
  [string]$SequenceId  = "",
  [string]$ConnectionId = "",
  [int]$DefaultVus     = 10,
  [string]$DefaultDuration = "30s",
  [switch]$SkipChaos,
  [switch]$SkipK6,
  [switch]$ConsistencyOnly
)

$ErrorActionPreference = "Continue"

# ─── Color helpers ────────────────────────────────────────────────
function Write-Pass($msg) { Write-Host "  [PASS] $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "  [INFO] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Header($msg) {
  Write-Host ""
  Write-Host ("=" * 65) -ForegroundColor Blue
  Write-Host "  $msg" -ForegroundColor Blue
  Write-Host ("=" * 65) -ForegroundColor Blue
}

# ─── Tracking ─────────────────────────────────────────────────────
$results    = @()
$startTime  = Get-Date
$reportFile = "tests\reports\test_run_$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"

New-Item -ItemType Directory -Force -Path "tests\reports" | Out-Null

function Record-Result {
  param($Suite, $Test, $Status, $Detail = "")
  $results += [PSCustomObject]@{
    Suite  = $Suite
    Test   = $Test
    Status = $Status
    Detail = $Detail
    Time   = (Get-Date).ToString("HH:mm:ss")
  }
  if ($Status -eq "PASS") { Write-Pass "$Test — $Detail" }
  elseif ($Status -eq "FAIL") { Write-Fail "$Test — $Detail" }
  else { Write-Warn "$Test — $Detail" }
}

function Run-K6 {
  param($ScriptPath, $EnvVars = @{}, $Label = "k6 test")

  $envArgs = $EnvVars.GetEnumerator() | ForEach-Object { "-e $($_.Key)=$($_.Value)" }
  $cmd     = "k6 run $ScriptPath " + ($envArgs -join " ")

  Write-Info "Running: $cmd"

  try {
    $output  = & k6 run $ScriptPath @(
      $EnvVars.GetEnumerator() | ForEach-Object { @("-e", "$($_.Key)=$($_.Value)") } | 
      ForEach-Object { $_ }
    ) 2>&1

    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
      return @{ Status = "PASS"; Output = $output }
    } else {
      Write-Warn "k6 exit code: $exitCode"
      return @{ Status = "FAIL"; Output = $output }
    }
  } catch {
    return @{ Status = "ERROR"; Output = $_.Exception.Message }
  }
}

# ─── Pre-flight checks ─────────────────────────────────────────────
Write-Header "PRE-FLIGHT CHECKS"

# Check k6
try {
  $k6Version = (& k6 version 2>&1) | Select-Object -First 1
  Write-Pass "k6 installed: $k6Version"
} catch {
  Write-Fail "k6 is NOT installed. Install from https://k6.io/docs/get-started/installation/"
  if (-not $SkipK6) { exit 1 }
}

# Check Node.js
try {
  $nodeVersion = (& node --version 2>&1)
  Write-Pass "Node.js: $nodeVersion"
} catch {
  Write-Fail "Node.js is NOT installed"
  exit 1
}

# Check backend is responding
try {
  $pingRes = Invoke-WebRequest -Uri "$BaseUrl/api/health/ping" -TimeoutSec 5 -ErrorAction Stop
  Write-Pass "Backend is UP: $BaseUrl"
} catch {
  Write-Fail "Backend is NOT responding at $BaseUrl — start the backend first"
  exit 1
}

if (-not $SequenceId) { Write-Warn "SEQUENCE_ID not provided — some tests will be skipped" }
if (-not $ConnectionId) { Write-Warn "CONNECTION_ID not provided — sequence creation tests limited" }

# ─── PHASE 1: Database Baseline ───────────────────────────────────
Write-Header "PHASE 1: PRE-TEST DATABASE BASELINE"

Write-Info "Running database consistency check (pre-test)..."
$preCheck = & node tests\consistency\check_db_consistency.js 2>&1
$preCheckStatus = if ($LASTEXITCODE -eq 0) { "PASS" } else { "WARN" }
Record-Result "Consistency" "Pre-test DB baseline" $preCheckStatus "Exit code: $LASTEXITCODE"

if ($ConsistencyOnly) {
  Write-Header "CONSISTENCY-ONLY MODE — Skipping load tests"
  goto Summary
}

# ─── PHASE 2: k6 Load Tests ───────────────────────────────────────
if (-not $SkipK6) {
  Write-Header "PHASE 2: k6 LOAD TESTS"

  $commonEnv = @{
    BASE_URL   = $BaseUrl
    USER1_EMAIL = $User1Email
    USER1_PASS  = $User1Pass
    USER2_EMAIL = $User2Email
    USER2_PASS  = $User2Pass
  }

  # 2.1 Login Concurrency
  Write-Info "2.1 — Login Concurrency Test (VUs=$DefaultVus, $DefaultDuration)"
  $r = Run-K6 "tests\k6\scenarios\01_login.js" ($commonEnv + @{
    VUS      = $DefaultVus
    DURATION = $DefaultDuration
  }) "Login Concurrency"
  Record-Result "k6" "Login Concurrency" $r.Status "VUs=$DefaultVus"

  # 2.2 Sequence Lifecycle
  Write-Info "2.2 — Sequence Lifecycle Test (VUs=$DefaultVus, $DefaultDuration)"
  if ($ConnectionId) {
    $r = Run-K6 "tests\k6\scenarios\02_sequence_lifecycle.js" ($commonEnv + @{
      VUS                  = $DefaultVus
      DURATION             = $DefaultDuration
      EMAIL_CONNECTION_ID  = $ConnectionId
    }) "Sequence Lifecycle"
    Record-Result "k6" "Sequence Lifecycle (Activate/Pause/Resume/Reschedule)" $r.Status "VUs=$DefaultVus"
  } else {
    Record-Result "k6" "Sequence Lifecycle" "SKIP" "No CONNECTION_ID"
  }

  # 2.3 Health APIs
  Write-Info "2.3 — Health API Concurrency Test (VUs=30, $DefaultDuration)"
  $r = Run-K6 "tests\k6\scenarios\03_health_apis.js" ($commonEnv + @{
    VUS      = 30
    DURATION = $DefaultDuration
  }) "Health APIs"
  Record-Result "k6" "Health API Concurrency" $r.Status "VUs=30"

  # 2.4 Queue Rebuild
  Write-Info "2.4 — Queue Rebuild Concurrency Test"
  $r = Run-K6 "tests\k6\scenarios\04_queue_rebuild.js" $commonEnv "Queue Rebuild"
  Record-Result "k6" "Queue Rebuild Concurrency (1→3→5 VUs)" $r.Status ""

  # 2.5 Bulk Import (100 contacts)
  Write-Info "2.5 — Bulk Import Test (100 contacts, VUs=5)"
  $importEnv = $commonEnv + @{
    VUS         = 5
    DURATION    = "60s"
    IMPORT_SIZE = 100
  }
  if ($SequenceId) { $importEnv["SEQUENCE_ID"] = $SequenceId }
  $r = Run-K6 "tests\k6\scenarios\05_bulk_contact_import.js" $importEnv "Bulk Import 100"
  Record-Result "k6" "Bulk Import (100 contacts, 5 VUs)" $r.Status ""

  # 2.6 Email Send Load (100 emails)
  if ($SequenceId -and $ConnectionId) {
    Write-Info "2.6 — Email Send Load (100 emails)"
    $r = Run-K6 "tests\k6\scenarios\06_email_send_load.js" ($commonEnv + @{
      EMAIL_COUNT         = 100
      EMAIL_CONNECTION_ID = $ConnectionId
      MONITOR_DURATION_S  = 120
    }) "Email Send Load 100"
    Record-Result "k6" "Email Send Load (100 emails)" $r.Status ""
  } else {
    Record-Result "k6" "Email Send Load" "SKIP" "No SEQUENCE_ID or CONNECTION_ID"
  }

  # 2.7 Race Conditions
  if ($SequenceId) {
    Write-Info "2.7 — Race Condition Tests (RC-01 through RC-05)"
    $r = Run-K6 "tests\k6\scenarios\07_race_conditions.js" ($commonEnv + @{
      SEQUENCE_ID = $SequenceId
    }) "Race Conditions"
    Record-Result "k6" "Race Conditions (5 scenarios)" $r.Status "SEQUENCE_ID=$SequenceId"
  } else {
    Record-Result "k6" "Race Conditions" "SKIP" "No SEQUENCE_ID"
  }
}

# ─── PHASE 3: Multi-Worker Tests ──────────────────────────────────
Write-Header "PHASE 3: MULTI-WORKER TESTS"

if ($SequenceId) {
  $workerCounts = @(1, 2)
  foreach ($wc in $workerCounts) {
    Write-Info "Testing with WORKER_COUNT=$wc, CONTACT_COUNT=20"
    $env:BASE_URL     = $BaseUrl
    $env:USER_EMAIL   = $User1Email
    $env:USER_PASSWORD = $User1Pass
    $env:SEQUENCE_ID  = $SequenceId
    $env:WORKER_COUNT = $wc
    $env:CONTACT_COUNT = 20
    $env:DRAIN_TIMEOUT_MS = 60000

    $output = & node tests\scripts\multi_worker_test.js 2>&1
    $status = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }
    Record-Result "MultiWorker" "Worker count = $wc" $status "Exit: $LASTEXITCODE"
  }
} else {
  Record-Result "MultiWorker" "Multi-worker tests" "SKIP" "No SEQUENCE_ID"
}

# ─── PHASE 4: Chaos Tests ─────────────────────────────────────────
if (-not $SkipChaos -and $SequenceId) {
  Write-Header "PHASE 4: CHAOS TESTS"
  Write-Warn "Chaos tests are DESTRUCTIVE — run only on non-production systems!"

  # Redis crash simulation
  Write-Info "4.1 — Redis Crash Simulation"
  $env:BASE_URL      = $BaseUrl
  $env:USER_EMAIL    = $User1Email
  $env:USER_PASSWORD = $User1Pass
  $env:SEQUENCE_ID   = $SequenceId
  $env:CRASH_AFTER_MS = 3000
  $env:RECOVERY_WAIT_MS = 10000

  $output  = & node tests\chaos\redis_crash.js 2>&1
  $status  = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }
  Record-Result "Chaos" "Redis Crash & Recovery" $status "Exit: $LASTEXITCODE"
} elseif ($SkipChaos) {
  Record-Result "Chaos" "All chaos tests" "SKIP" "SkipChaos flag set"
}

# ─── PHASE 5: Post-Test Consistency Check ─────────────────────────
Write-Header "PHASE 5: POST-TEST DATABASE CONSISTENCY"

Write-Info "Running database consistency check (post-test)..."
$postCheck = & node tests\consistency\check_db_consistency.js 2>&1
$postCheckStatus = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }
Record-Result "Consistency" "Post-test DB consistency" $postCheckStatus "Exit: $LASTEXITCODE"

# ─── SUMMARY ──────────────────────────────────────────────────────
:Summary
Write-Header "TEST RUN SUMMARY"

$passed  = ($results | Where-Object Status -eq "PASS").Count
$failed  = ($results | Where-Object Status -eq "FAIL").Count
$skipped = ($results | Where-Object Status -eq "SKIP").Count
$warned  = ($results | Where-Object Status -eq "WARN").Count
$total   = $results.Count
$elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)

$results | Format-Table Suite, Test, Status, Detail, Time -AutoSize

Write-Host ""
Write-Host ("─" * 65) -ForegroundColor Blue
Write-Host "  TOTAL: $total | PASSED: $passed | FAILED: $failed | SKIPPED: $skipped | WARNED: $warned" -ForegroundColor White
Write-Host "  Total duration: ${elapsed}s" -ForegroundColor White
Write-Host ("─" * 65) -ForegroundColor Blue

# Save report
$results | Export-Csv -Path $reportFile -NoTypeInformation
Write-Info "Report saved: $reportFile"

if ($failed -gt 0) {
  Write-Host ""
  Write-Host "  ❌ SOME TESTS FAILED — Review failures before production deployment!" -ForegroundColor Red
  exit 1
} else {
  Write-Host ""
  Write-Host "  ✅ ALL TESTS PASSED — System is production-ready" -ForegroundColor Green
  exit 0
}
