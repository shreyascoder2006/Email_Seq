import mongoose, { Types } from 'mongoose';
import { Sequence, SequenceStatus } from '../src/models/Sequence';
import { SequenceStep, StepType } from '../src/models/SequenceStep';
import { SequenceContact } from '../src/models/SequenceContact';
import { enrollmentService } from '../src/services/enrollment.service';
import { sequenceService } from '../src/services/sequence.service';

const MONGO_URI = 'mongodb://localhost:27017/email_sequencing';

async function run() {
  console.log('Connecting to database...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected to database.');

  const userId = new Types.ObjectId();
  const sequenceId = new Types.ObjectId();

  // Cleanup old diagnostics if any
  await Sequence.deleteOne({ name: 'Activation Fix Test Sequence' });
  await SequenceContact.deleteMany({ contact_email: 'activation-test@example.com' });

  // 1. Create a sequence in DRAFT with a restrictive sending window (e.g. 9am-5pm)
  // Let's set timezone to "America/New_York".
  console.log('\nCreating test sequence...');
  const seq = await Sequence.create({
    _id: sequenceId,
    user_id: userId,
    name: 'Activation Fix Test Sequence',
    launch_date: new Date(),
    daily_sending_limit: 100,
    reserved_limit_phase1: 50,
    status: SequenceStatus.DRAFT,
    sending_window: {
      timezone: 'America/New_York',
      schedule: 'all_days',
      start_hour: 9,
      end_hour: 17,
    },
  });

  const step = await SequenceStep.create({
    sequence_id: sequenceId,
    user_id: userId,
    step_index: 0,
    type: StepType.EMAIL,
    delay_days: 0,
    delay_hours: 0,
    is_active: true,
  });

  // Activate to allow enrollment
  await sequenceService.transition(userId.toString(), sequenceId.toString(), { status: SequenceStatus.ACTIVE });

  // 2. Test enrollment metadata
  console.log('\nEnrolling test contact...');
  const enrollResult = await enrollmentService.enroll(userId.toString(), sequenceId.toString(), {
    contacts: [
      {
        email: 'activation-test@example.com',
        first_name: 'Activation',
        last_name: 'Test',
        custom_variables: {},
      },
    ],
    skip_existing: true,
  });

  console.log('Enrollment Result:', {
    enrolled: enrollResult.enrolled,
    isOutsideWindow: enrollResult.isOutsideWindow,
    nextAvailableWindow: enrollResult.nextAvailableWindow,
  });

  // 3. Test activation transition adjustment
  // Let's pause the sequence first
  await sequenceService.transition(userId.toString(), sequenceId.toString(), { status: SequenceStatus.PAUSED });

  // Reset contact next_send_at to null to trigger the activation bump
  await SequenceContact.updateOne(
    { sequence_id: sequenceId },
    { $set: { next_send_at: null } }
  );

  console.log('\nTransitioning sequence PAUSED -> ACTIVE...');
  // Transition paused -> active
  await sequenceService.transition(userId.toString(), sequenceId.toString(), { status: SequenceStatus.ACTIVE });

  // Retrieve contact's new next_send_at
  const contact = await SequenceContact.findOne({ sequence_id: sequenceId });
  console.log('Updated contact next_send_at:', contact?.next_send_at);

  // Check if next_send_at matches the sending window (since current New York time is early morning/outside the window)
  if (contact?.next_send_at) {
    const localNYTime = contact.next_send_at.toLocaleString('en-US', { timeZone: 'America/New_York' });
    console.log('NY Local Time for contact next_send_at:', localNYTime);
    
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    });
    const nyHour = parseInt(formatter.format(contact.next_send_at), 10);
    console.log('Parsed NY local hour:', nyHour);
    if (nyHour === 9) {
      console.log('✅ SUCCESS: next_send_at correctly adjusted to sending window on activation!');
    } else {
      console.log('❌ FAILURE: next_send_at not adjusted properly.');
    }
  }

  // Cleanup
  await Sequence.deleteOne({ _id: sequenceId });
  await SequenceStep.deleteOne({ _id: step._id });
  await SequenceContact.deleteMany({ sequence_id: sequenceId });
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
