import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { Sequence, SequenceStatus } from '../src/models/Sequence';
import { SequenceContact } from '../src/models/SequenceContact';
import { sequenceService } from '../src/services/sequence.service';

async function main() {
  await mongoose.connect(env.MONGO_URI);
  console.log('Connected to DB');

  // 1. Create a dummy sequence
  const userId = new mongoose.Types.ObjectId().toString();
  const sequence = await Sequence.create({
    user_id: userId,
    name: 'Activation Test Sequence',
    status: 'draft',
    sending_window: {
      timezone: 'UTC',
      schedule: 'all_days',
      start_hour: 0,
      start_minute: 0,
      end_hour: 23,
      end_minute: 59,
    },
    launch_date: new Date()
  });

  // 2. Create a contact
  await SequenceContact.create({
    sequence_id: sequence._id,
    user_id: userId,
    contact_email: 'test@example.com',
    status: 'active',
    current_step_index: 0,
  });

  console.log(`Sequence created: ${sequence._id}`);
  console.log(`Activating...`);

  // 3. Trigger transition
  await sequenceService.transition(userId, sequence._id.toString(), { status: SequenceStatus.ACTIVE });

  console.log(`✅ Activated.`);
  
  // Wait for jobs to process
  console.log('Waiting 3 seconds for workers...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  await mongoose.disconnect();
  console.log('Done.');
  process.exit(0);
}

main().catch(console.error);
