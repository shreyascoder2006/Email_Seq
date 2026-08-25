#!/usr/bin/env ts-node
/**
 * backend/scripts/dev/verify-tracking.ts
 *
 * Diagnostic script — run against a live MongoDB to verify the tracking
 * pipeline is healthy after the is_first_click / message-ID fixes.
 *
 * Usage:
 *   npx ts-node backend/scripts/dev/verify-tracking.ts
 *
 * Checks:
 *  1. ClickLog anomalies:
 *       (a) Rows with is_first_click=true AND click_count=0
 *           → these are pre-migration stale rows (should be 0 post-fix)
 *       (b) Rows with is_first_click=false AND click_count>0
 *           → should be 0 after the fix (old inverted-logic rows)
 *  2. SendingLog message_id format — all rows should have angle brackets
 *  3. APP_BASE_URL value — warns if localhost
 *  4. Log-collection totals (quick sanity count)
 */

import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌  MONGO_URI is not set in .env');
  process.exit(1);
}

// ─── Minimal model references (avoid importing full app config) ───────────────

const ClickLogSchema = new mongoose.Schema({ is_first_click: Boolean, click_count: Number }, { collection: 'click_logs' });
const SendingLogSchema = new mongoose.Schema({ message_id: String }, { collection: 'sending_logs' });
const OpenLogSchema = new mongoose.Schema({}, { collection: 'open_logs' });
const ReplyLogSchema = new mongoose.Schema({}, { collection: 'reply_logs' });
const BounceLogSchema = new mongoose.Schema({}, { collection: 'bounce_logs' });

const ClickLog   = mongoose.models.ClickLog   ?? mongoose.model('ClickLog',   ClickLogSchema);
const SendingLog = mongoose.models.SendingLog ?? mongoose.model('SendingLog', SendingLogSchema);
const OpenLog    = mongoose.models.OpenLog    ?? mongoose.model('OpenLog',    OpenLogSchema);
const ReplyLog   = mongoose.models.ReplyLog   ?? mongoose.model('ReplyLog',   ReplyLogSchema);
const BounceLog  = mongoose.models.BounceLog  ?? mongoose.model('BounceLog',  BounceLogSchema);

// ─── Checks ──────────────────────────────────────────────────────────────────

let issues = 0;

function pass(msg: string)  { console.log(`  ✅  ${msg}`); }
function warn(msg: string)  { console.warn(`  ⚠️   ${msg}`); issues++; }
function fail(msg: string)  { console.error(`  ❌  ${msg}`); issues++; }
function info(msg: string)  { console.log(`  ℹ️   ${msg}`); }

async function checkClickLogSemantics() {
  console.log('\n── Check 1: ClickLog is_first_click semantics ──────────────────────');

  // (a) Stale rows: clicked=true but count=0 (pre-fix pre-created rows that were never clicked)
  const staleCount = await ClickLog.countDocuments({ is_first_click: true, click_count: 0 });
  if (staleCount === 0) {
    pass('No stale pre-created rows (is_first_click=true AND click_count=0)');
  } else {
    warn(
      `${staleCount} ClickLog row(s) have is_first_click=true but click_count=0.\n` +
      '    These are pre-migration rows. Analytics over-counts clicks by this amount.\n' +
      '    Run the one-time migration below to fix existing data:\n\n' +
      '    db.click_logs.updateMany(\n' +
      '      { is_first_click: true, click_count: 0 },\n' +
      '      { $set: { is_first_click: false } }\n' +
      '    )\n'
    );
  }

  // (b) Old-logic rows: clicked=false but count>0 (rows updated under the old inverted logic)
  const invertedCount = await ClickLog.countDocuments({ is_first_click: false, click_count: { $gt: 0 } });
  if (invertedCount === 0) {
    pass('No inverted-logic rows (is_first_click=false AND click_count>0)');
  } else {
    warn(
      `${invertedCount} ClickLog row(s) have is_first_click=false but click_count>0.\n` +
      '    These were updated under the old (inverted) logic before the fix.\n' +
      '    Run the one-time migration below:\n\n' +
      '    db.click_logs.updateMany(\n' +
      '      { is_first_click: false, click_count: { $gt: 0 } },\n' +
      '      { $set: { is_first_click: true } }\n' +
      '    )\n'
    );
  }

  const totalClicks = await ClickLog.countDocuments({ is_first_click: true, click_count: { $gt: 0 } });
  info(`${totalClicks} correctly-formed click records (is_first_click=true, click_count>0)`);
}

async function checkMessageIdFormat() {
  console.log('\n── Check 2: SendingLog message_id angle-bracket format ─────────────');

  // All message_ids must be non-null strings starting with '<'
  const withoutBrackets = await SendingLog.countDocuments({
    message_id: { $exists: true, $not: /^</ },
  });

  if (withoutBrackets === 0) {
    pass('All SendingLog.message_id values have leading angle bracket');
  } else {
    fail(
      `${withoutBrackets} SendingLog row(s) have message_id WITHOUT a leading '<'.\n` +
      '    These cannot be matched by the inboundMessage.service.ts exact-match lookup.\n' +
      '    Investigate emailQueue.ts message-ID generation.'
    );
  }

  const totalWithMessageId = await SendingLog.countDocuments({ message_id: { $exists: true } });
  info(`${totalWithMessageId} SendingLog rows have a message_id field`);
}

async function checkAppBaseUrl() {
  console.log('\n── Check 3: APP_BASE_URL configuration ─────────────────────────────');

  const appBaseUrl = process.env.APP_BASE_URL ?? '(not set)';
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?\s*$/.test(appBaseUrl);

  if (isLocalhost) {
    warn(
      `APP_BASE_URL="${appBaseUrl}" is a localhost address.\n` +
      '    Tracking pixel, click-redirect, and unsubscribe URLs embedded in\n' +
      '    sent emails are unreachable from recipients.\n' +
      '    Set APP_BASE_URL to your public server URL in .env'
    );
  } else if (appBaseUrl === '(not set)') {
    warn('APP_BASE_URL is not set in .env — defaults to http://localhost:5000');
  } else {
    pass(`APP_BASE_URL="${appBaseUrl}" (non-localhost)`);
  }
}

async function checkLogTotals() {
  console.log('\n── Check 4: Log-collection totals ──────────────────────────────────');

  const [sends, opens, clicks, replies, bounces] = await Promise.all([
    SendingLog.countDocuments(),
    OpenLog.countDocuments(),
    ClickLog.countDocuments(),
    ReplyLog.countDocuments(),
    BounceLog.countDocuments(),
  ]);

  info(`SendingLog : ${sends}`);
  info(`OpenLog    : ${opens}`);
  info(`ClickLog   : ${clicks}`);
  info(`ReplyLog   : ${replies}`);
  info(`BounceLog  : ${bounces}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n🔍  verify-tracking.ts — Tracking Pipeline Diagnostics');
  console.log('=========================================================');

  try {
    await mongoose.connect(MONGO_URI!, { dbName: undefined });
    console.log(`\n✅  Connected to MongoDB`);

    await checkClickLogSemantics();
    await checkMessageIdFormat();
    await checkAppBaseUrl();
    await checkLogTotals();

    console.log('\n=========================================================');
    if (issues === 0) {
      console.log('✅  All checks passed — tracking pipeline looks healthy.\n');
    } else {
      console.warn(`⚠️   ${issues} issue(s) found — see details above.\n`);
    }
  } catch (err) {
    console.error('❌  Fatal error:', (err as Error).message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
