import mongoose from 'mongoose';
import { SequenceContact } from '../src/models/SequenceContact';
import { Sequence } from '../src/models/Sequence';
import { enrollmentService } from '../src/services/enrollment.service';

async function run() {
  await mongoose.connect('mongodb://localhost:27017/email_sequencing');
  
  // Find a user and sequence
  const seq = await Sequence.findOne({ status: 'active' });
  if (!seq) {
    console.log("No active sequence found. Need an active sequence to enroll.");
    process.exit(1);
  }

  console.log(`Using Sequence: ${seq.name} (${seq._id})`);

  try {
    const result = await enrollmentService.enroll(seq.user_id.toString(), seq._id.toString(), {
      contacts: [
        { email: `test-${Date.now()}@example.com`, first_name: 'Test', last_name: 'User', custom_variables: {} }
      ],
      skip_existing: true
    });
    console.log("Enrollment Result:");
    console.dir(result, { depth: null });

    const inDb = await SequenceContact.find({ sequence_id: seq._id });
    console.log(`Contacts in DB for this sequence: ${inDb.length}`);
  } catch (err) {
    console.error("Error:", err);
  }

  process.exit(0);
}

run();
