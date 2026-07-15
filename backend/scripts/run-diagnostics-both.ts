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
  console.log(`Found connection: ${conn._id}`);

  // Find any contact that uses this connection via its sequence.
  // The easiest way is to look for a contact that failed recently or is active,
  // but we can also just find the most recent contact in the system for this user.
  // Let's just find ANY SequenceContact and manually patch its sequence_id to point to a sequence with this connection.
  // Wait, no, we need an existing Sequence and SequenceStep for processEmailSend to pass integrity checks.

  const { Sequence } = require('../src/models/Sequence');
  const seq = await Sequence.findOne({ email_connection_id: conn._id });
  if (!seq) {
    console.log(`No sequence found using connection ${conn._id}`);
    return;
  }
  console.log(`Found sequence: ${seq._id}`);

  let contact = await SequenceContact.findOne({ sequence_id: seq._id }).sort({ _id: -1 });
  if (!contact) {
    console.log(`No contacts found for sequence ${seq._id}`);
    return;
  }
  console.log(`Found contact: ${contact._id} (${contact.contact_email})`);

  // Ensure contact is active and unlocked so processEmailSend accepts it
  contact.status = ContactEnrollmentStatus.ACTIVE;
  contact.sending_locked = false;
  contact.schedule_version = contact.schedule_version || 1;
  await contact.save();

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
  console.log('Connected to MongoDB');

  await runDiagnostic('shreyaskale06@gmail.com');
  await runDiagnostic('amol@cloudslead.com');

  console.log('\n\n--- ALL DIAGNOSTICS COMPLETE ---');
  process.exit(0);
}

run();
