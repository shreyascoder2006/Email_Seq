import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { processEmailSend } from '../src/queues/emailQueue';
import { SequenceContact, ContactEnrollmentStatus } from '../src/models/SequenceContact';
import { EmailConnection } from '../src/models/EmailConnection';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/email_sequencing');
  console.log('Connected to MongoDB');

  // Find a contact that failed or is active, belonging to CloudsLead
  // First, find the cloudslead connection
  const cloudsLeadConn = await EmailConnection.findOne({ from_email: 'amol@cloudslead.com' });
  const gmailConn = await EmailConnection.findOne({ from_email: 'shreyaskale06@gmail.com' });

  console.log('CloudsLead Conn:', cloudsLeadConn?._id);
  console.log('Gmail Conn:', gmailConn?._id);

  // For testing, let's just find any contact that is linked to these connections through their sequence
  // But wait, the sequence might be paused. Let's just find any sequence contact.
  const cloudsLeadContact = await SequenceContact.findOne({ 
    status: ContactEnrollmentStatus.FAILED 
  }).sort({ _id: -1 });

  if (cloudsLeadContact) {
    console.log('Testing CloudsLead Contact:', cloudsLeadContact._id);
    
    // Force active to allow send
    cloudsLeadContact.status = ContactEnrollmentStatus.ACTIVE;
    cloudsLeadContact.sending_locked = false;
    await cloudsLeadContact.save();

    try {
      await processEmailSend({
        id: 'test-job-cloudslead',
        data: {
          sequenceContactId: cloudsLeadContact._id.toString(),
          stepIndex: cloudsLeadContact.current_step_index,
          tickSource: 'manual_test',
          sequenceId: cloudsLeadContact.sequence_id.toString(),
          scheduleVersion: cloudsLeadContact.schedule_version,
        }
      } as any);
    } catch (e: any) {
      console.error('Job failed with:', e.message);
    }
  }

  // To test Gmail, we need a contact linked to the Gmail sequence.
  // We'll let the user run it from the UI or we can run the test script.
  process.exit(0);
}

run();
