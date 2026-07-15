import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { processEmailSend } from '../src/queues/emailQueue';
import { SequenceContact, ContactEnrollmentStatus } from '../src/models/SequenceContact';
import { EmailConnection } from '../src/models/EmailConnection';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function runDiagnostic(email: string) {
  console.log(`\n\n===========================================`);
  console.log(`STARTING DIAGNOSTIC FOR: ${email}`);
  console.log(`===========================================\n`);
  
  const conn = await EmailConnection.findOne({ from_email: email });
  if (!conn) {
    console.log(`Connection for ${email} not found.`);
    return;
  }

  const { Sequence } = require('../src/models/Sequence');
  let seq = await Sequence.findOne({ email_connection_id: conn._id });
  if (!seq) {
    // try to find any sequence and just temporarily mock the connection id for the test
    seq = await Sequence.findOne();
    if (!seq) {
        console.log(`No sequences in DB`);
        return;
    }
  }

  let contact = await SequenceContact.findOne({ sequence_id: seq._id }).sort({ _id: -1 });
  if (!contact) {
    // create a fake one
    contact = new SequenceContact({
        sequence_id: seq._id,
        user_id: conn.user_id,
        contact_email: 'diagnostic-test-2@example.com',
        current_step_index: 0,
        status: ContactEnrollmentStatus.ACTIVE,
        sending_locked: false
    });
    await contact.save();
  } else {
      contact.status = ContactEnrollmentStatus.ACTIVE;
      contact.sending_locked = false;
      await contact.save();
  }

  // To ensure the step is loaded, we temporarily inject the connection into the step if we need to.
  // We'll let processEmailSend handle it, but wait, processEmailSend looks at the sequence step!
  const { SequenceStep } = require('../src/models/SequenceStep');
  const step = await SequenceStep.findOne({ sequence_id: seq._id, step_index: contact.current_step_index });
  if (step) {
      step.email_connection_id = conn._id;
      await step.save();
  }

  try {
    await processEmailSend({
      id: `test-job-${email}`,
      data: {
        sequenceContactId: contact._id.toString(),
        stepIndex: contact.current_step_index,
        tickSource: 'manual_diagnostic',
        sequenceId: contact.sequence_id.toString(),
        scheduleVersion: contact.schedule_version,
      }
    } as any);
  } catch (e: any) {
    console.log(`\nprocessEmailSend threw an error for ${email}:`, e.message);
  }
}

async function run() {
  const uri = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/email_sequencing').replace('localhost', '127.0.0.1');
  await mongoose.connect(uri);

  // The 3 accounts from the UI screenshot
  await runDiagnostic('shreyaskale06@gmail.com');
  await runDiagnostic('amol@cloudslead.com');
  await runDiagnostic('amol@cloudoauth.info');

  console.log('\n\n--- ALL DIAGNOSTICS COMPLETE ---');
  process.exit(0);
}

run();
