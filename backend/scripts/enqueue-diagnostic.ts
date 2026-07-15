import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Queue } from 'bullmq';
import { SequenceContact, ContactEnrollmentStatus } from '../src/models/SequenceContact';
import { EmailConnection } from '../src/models/EmailConnection';
import { BULL_REDIS_URL } from '../src/config/redis';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const queue = new Queue('email-sequence', {
  connection: {
    host: '127.0.0.1',
    port: 6379
  }
});

async function runTest(email: string) {
  console.log(`Enqueuing test for: ${email}`);
  const conn = await EmailConnection.findOne({ from_email: email });
  if (!conn) {
    console.log(`Connection for ${email} not found.`);
    return;
  }

  const { Sequence } = require('../src/models/Sequence');
  let seq = await Sequence.findOne({ email_connection_id: conn._id });
  if (!seq) {
    seq = await Sequence.findOne();
    if (!seq) return;
  }

  let contact = await SequenceContact.findOne({ sequence_id: seq._id }).sort({ _id: -1 });
  if (!contact) {
    contact = new SequenceContact({
        sequence_id: seq._id,
        user_id: conn.user_id,
        contact_email: 'diagnostic-test-worker@example.com',
        current_step_index: 0,
        status: ContactEnrollmentStatus.ACTIVE,
        sending_locked: false,
        schedule_version: 1
    });
    await contact.save();
  } else {
      contact.status = ContactEnrollmentStatus.ACTIVE;
      contact.sending_locked = false;
      contact.schedule_version = contact.schedule_version || 1;
      await contact.save();
  }

  const { SequenceStep } = require('../src/models/SequenceStep');
  const step = await SequenceStep.findOne({ sequence_id: seq._id, step_index: contact.current_step_index });
  if (step) {
      step.email_connection_id = conn._id;
      await step.save();
  }

  await queue.add('send-email', {
    sequenceContactId: contact._id.toString(),
    stepIndex: contact.current_step_index,
    tickSource: 'manual_diagnostic_bullmq',
    sequenceId: contact.sequence_id.toString(),
    scheduleVersion: contact.schedule_version,
  }, {
    jobId: `test-job-worker-${email}-${Date.now()}`
  });
  console.log(`Job added for ${email}`);
}

async function run() {
  const uri = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/email_sequencing').replace('localhost', '127.0.0.1');
  await mongoose.connect(uri);

  await runTest('shreyaskale06@gmail.com');
  await runTest('amol@cloudslead.com');

  console.log('Finished enqueuing. Checking worker logs in a few seconds...');
  setTimeout(() => process.exit(0), 2000);
}

run();
