import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Queue } from 'bullmq';
import { SequenceContact, ContactEnrollmentStatus } from '../src/models/SequenceContact';
import { EmailConnection } from '../src/models/EmailConnection';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const queue = new Queue('email-sequence', {
  connection: { host: '127.0.0.1', port: 6379 }
});

async function triggerFailedContact(email: string) {
  console.log(`Finding failed contacts for: ${email}`);
  const conn = await EmailConnection.findOne({ from_email: email });
  if (!conn) return;

  const { Sequence } = require('../src/models/Sequence');
  let seq = await Sequence.findOne({ email_connection_id: conn._id });
  if (!seq) return;

  // Find a contact that actually failed in the past
  const { SendingLog } = require('../src/models/SendingLog');
  const failedLogs = await SendingLog.find({ from_email: email, status: 'failed' }).sort({ failed_at: -1 }).limit(1);
  
  if (failedLogs.length > 0) {
      const failedLog = failedLogs[0];
      console.log(`Found failed log for ${failedLog.to_email}. Enqueuing contact...`);
      let contact = await SequenceContact.findOne({ _id: failedLog.sequence_contact_id });
      if (contact) {
          contact.status = ContactEnrollmentStatus.ACTIVE;
          contact.sending_locked = false;
          contact.schedule_version = (contact.schedule_version || 1) + 1;
          await contact.save();
          
          await queue.add('send-email', {
            sequenceContactId: contact._id.toString(),
            stepIndex: contact.current_step_index,
            tickSource: 'manual_diagnostic_bullmq',
            sequenceId: contact.sequence_id.toString(),
            scheduleVersion: contact.schedule_version,
          }, {
            jobId: `test-real-failure-${email}-${Date.now()}`
          });
          console.log(`Enqueued job for real failed contact.`);
      }
  } else {
      console.log(`No failed logs found for ${email}`);
  }
}

async function run() {
  const uri = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/email_sequencing').replace('localhost', '127.0.0.1');
  await mongoose.connect(uri);

  await triggerFailedContact('amol@cloudslead.com');

  console.log('Finished enqueuing real failed contact.');
  setTimeout(() => process.exit(0), 2000);
}

run();
