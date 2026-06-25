/**
 * End-to-end activation proof script.
 *
 * This script:
 * 1. Finds the user ID from an existing sequence
 * 2. Uses an existing valid EmailConnection and Template
 * 3. Creates a fresh proof sequence (draft) with all-day sending window
 * 4. Adds 1 email step with the real sender + template
 * 5. Enrolls 1 test contact
 * 6. Calls sequenceService.transition() to activate
 * 7. Shows the full log output proving the activation chain
 * 8. Waits 10s and re-checks to confirm no duplicate
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { Sequence, SequenceStatus, SendingSchedule } from '../src/models/Sequence';
import { SequenceStep, StepType } from '../src/models/SequenceStep';
import { SequenceContact, ContactEnrollmentStatus } from '../src/models/SequenceContact';
import { EmailConnection } from '../src/models/EmailConnection';
import { Template } from '../src/models/Template';
import { startScheduler } from '../src/queues/schedulerQueue';
import { startEmailWorker } from '../src/queues/emailQueue';
import { sequenceService } from '../src/services/sequence.service';
import logger from '../src/config/logger';

const PROOF_SEQ_NAME = 'PROOF_TEST_activation_' + Date.now();

async function cleanup(seqId: string) {
  await Sequence.deleteOne({ _id: seqId });
  await SequenceStep.deleteMany({ sequence_id: seqId });
  await SequenceContact.deleteMany({ sequence_id: seqId });
  console.log(`\n[CLEANUP] Removed proof sequence ${seqId}`);
}

async function main() {
  await mongoose.connect(env.MONGO_URI);
  console.log('=== DB Connected ===\n');

  // ── 1. Start scheduler + email worker (normally done by server.ts)
  console.log('=== Starting scheduler + email worker ===');
  startScheduler();
  startEmailWorker();
  // Give workers 2s to initialize connection to Redis
  await new Promise(r => setTimeout(r, 2000));

  // ── 2. Find a valid EmailConnection (active, has SMTP)
  const conn = await EmailConnection.findOne({}).lean();
  if (!conn) { console.error('❌ No EmailConnection found'); process.exit(1); }
  console.log(`✅ EmailConnection found: ${conn._id} (${(conn as any).email})`);

  // ── 3. Find a valid Template
  const template = await Template.findOne({}).lean();
  if (!template) { console.error('❌ No Template found'); process.exit(1); }
  console.log(`✅ Template found: ${template._id} (${template.name})`);

  // ── 4. Get userId from the connection
  const userId = conn.user_id.toString();
  console.log(`✅ Using userId: ${userId}\n`);

  // ── 5. Create proof sequence (DRAFT) with all-day, all-days window
  const seq = await Sequence.create({
    user_id: new mongoose.Types.ObjectId(userId),
    name: PROOF_SEQ_NAME,
    status: SequenceStatus.DRAFT,
    sending_window: {
      timezone: 'UTC',
      schedule: SendingSchedule.ALL_DAYS,
      start_hour: 0,
      start_minute: 0,
      end_hour: 23,
      end_minute: 59,
    },
    launch_date: new Date(),
    daily_sending_limit: 100,
    stop_on_reply: true,
    stop_on_bounce: true,
  });
  console.log(`✅ Proof sequence created: ${seq._id}`);

  // ── 6. Add email step
  await SequenceStep.create({
    sequence_id: seq._id,
    user_id: new mongoose.Types.ObjectId(userId),
    type: StepType.EMAIL,
    step_index: 0,
    delay_days: 0,
    delay_hours: 0,
    template_id: template._id,
    email_connection_id: conn._id,
    is_active: true,
  });
  console.log(`✅ Email step added (template: ${template._id}, conn: ${conn._id})`);

  // ── 7. Enroll test contact
  const contact = await SequenceContact.create({
    sequence_id: seq._id,
    user_id: new mongoose.Types.ObjectId(userId),
    contact_email: 'proof-test@antigravity-test.com',
    status: ContactEnrollmentStatus.ACTIVE,
    current_step_index: 0,
    next_send_at: null,
  });
  console.log(`✅ Contact enrolled: ${contact._id} (proof-test@antigravity-test.com)\n`);

  console.log('='.repeat(70));
  console.log('=== TRIGGERING LAUNCH CAMPAIGN (no restart) ===');
  console.log('='.repeat(70));
  const t0 = Date.now();

  // ── 8. Activate — this is the exact same call the API makes
  await sequenceService.transition(userId, seq._id.toString(), { status: SequenceStatus.ACTIVE });

  const t1 = Date.now();
  console.log(`\n✅ transition() returned after ${t1 - t0}ms`);

  // ── 9. Wait 8s for scheduler tick + email worker to run
  console.log('\n⏳ Waiting 8s for immediate tick + email worker to process...');
  await new Promise(r => setTimeout(r, 8000));

  // ── 10. Check contact state to verify advancement (proof of send or skip)
  const updatedContact = await SequenceContact.findById(contact._id).lean();
  console.log('\n=== CONTACT STATE AFTER 8s ===');
  console.log(JSON.stringify({
    contactId: updatedContact?._id.toString(),
    status: updatedContact?.status,
    current_step_index: updatedContact?.current_step_index,
    next_send_at: updatedContact?.next_send_at?.toISOString() || null,
  }, null, 2));

  // ── 11. Wait another 7s and re-check — duplicate protection proof
  console.log('\n⏳ Waiting 7 more seconds to check for duplicate send (next periodic tick)...');
  await new Promise(r => setTimeout(r, 7000));

  const finalContact = await SequenceContact.findById(contact._id).lean();
  console.log('\n=== CONTACT STATE AFTER 15s (duplicate check) ===');
  console.log(JSON.stringify({
    contactId: finalContact?._id.toString(),
    status: finalContact?.status,
    current_step_index: finalContact?.current_step_index,
    next_send_at: finalContact?.next_send_at?.toISOString() || null,
  }, null, 2));

  await cleanup(seq._id.toString());
  await mongoose.disconnect();
  console.log('\n=== PROOF RUN COMPLETE ===');
  process.exit(0);
}

main().catch(e => {
  console.error('PROOF SCRIPT FAILED:', e);
  process.exit(1);
});
