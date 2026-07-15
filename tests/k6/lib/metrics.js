/**
 * tests/k6/lib/metrics.js
 *
 * Reusable Custom Metrics for k6 testing.
 */
import { Rate, Trend, Gauge } from 'k6/metrics';

export const duplicateSendRate   = new Rate('duplicate_sends');
export const missedSendRate      = new Rate('missed_sends');
export const lockReleaseRate     = new Rate('lock_release_failures');
export const queueConsistencyRate = new Rate('queue_consistency_errors');
export const emailThroughput     = new Trend('email_throughput_ms');
export const workerPickupLatency = new Trend('worker_pickup_latency_ms');
export const apiErrorRate        = new Rate('api_errors');
export const raceWinnerRate      = new Rate('race_winner_2xx');
export const raceLoserRate       = new Rate('race_loser_4xx_409');
export const raceCrashRate       = new Rate('race_crash_5xx');

export const queueDepthGauge     = new Gauge('queue_depth_delayed');
export const activeJobsGauge     = new Gauge('queue_active_jobs');
export const failedJobsGauge     = new Gauge('queue_failed_jobs');
export const enrollmentDuration  = new Trend('enrollment_duration_ms');
