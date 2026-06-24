import mongoose, { Types } from 'mongoose';
import { Sequence, SequenceStatus } from '../src/models/Sequence';
import { SequenceStep, StepType } from '../src/models/SequenceStep';
import { sequenceService } from '../src/services/sequence.service';

const MONGO_URI = 'mongodb://localhost:27017/email_sequencing';

async function run() {
  console.log('Connecting to database...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected to database.');

  const userId = new Types.ObjectId();
  const sequenceId = new Types.ObjectId();

  console.log('\nCreating test sequence without template/connection...');
  const seq = await Sequence.create({
    _id: sequenceId,
    user_id: userId,
    name: 'Validation Test Sequence',
    launch_date: new Date(),
    daily_sending_limit: 100,
    reserved_limit_phase1: 50,
    status: SequenceStatus.DRAFT,
  });

  const step = await SequenceStep.create({
    sequence_id: sequenceId,
    user_id: userId,
    step_index: 0,
    type: StepType.EMAIL,
    delay_days: 0,
    delay_hours: 0,
    is_active: true,
    template_id: new Types.ObjectId(), // Added template_id
  });

  try {
    console.log('\nAttempting to activate sequence...');
    await sequenceService.transition(userId.toString(), sequenceId.toString(), { status: SequenceStatus.ACTIVE });
    console.log('❌ SUCCESS (Wait, it should have failed!)');
  } catch (err: any) {
    console.log('✅ Activation blocked as expected:');
    console.log('Status code:', err.statusCode);
    console.log('Message:', err.message);
    console.log('Details:', err.details);
  }

  // Cleanup
  await Sequence.deleteOne({ _id: sequenceId });
  await SequenceStep.deleteOne({ _id: step._id });
}

run()
  .catch(err => {
    console.error('Test run failed:', err);
    process.exit(1);
  })
  .finally(() => {
    mongoose.disconnect();
    process.exit(0);
  });
