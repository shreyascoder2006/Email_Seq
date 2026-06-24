import mongoose, { Types } from 'mongoose';
import { Sequence, SequenceStatus } from '../src/models/Sequence';
import { SequenceStep, StepType } from '../src/models/SequenceStep';
import { SequenceContact, ContactEnrollmentStatus } from '../src/models/SequenceContact';
import { enrollmentService } from '../src/services/enrollment.service';
import { sequenceService } from '../src/services/sequence.service';
import { Queue } from 'bullmq';
import { BULL_REDIS_URL, BULL_REDIS_TLS } from '../src/config/redis';

const MONGO_URI = 'mongodb://localhost:27017/email_sequencing';

function makeConnection() {
  const url = new URL(BULL_REDIS_URL);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    ...(url.password ? { password: url.password } : {}),
    ...(BULL_REDIS_TLS ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

async function run() {
  console.log('Connecting to database...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected to database.');

  const userId = new Types.ObjectId();
  const sequenceId = new Types.ObjectId();

  // Cleanup old diagnostics
  await Sequence.deleteOne({ name: 'Diagnostic Sequence' });
  await SequenceContact.deleteMany({ contact_email: 'diagnostic-test@example.com' });

  console.log('\n--- 1. Creating Diagnostic Sequence ---');
  const sequence = await Sequence.create({
    _id: sequenceId,
    user_id: userId,
    name: 'Diagnostic Sequence',
    launch_date: new Date(),
    daily_sending_limit: 100,
    reserved_limit_phase1: 50,
    status: SequenceStatus.DRAFT,
    sending_window: {
      timezone: 'Asia/Kolkata',
      schedule: 'all_days',
      start_hour: 9,
      end_hour: 17,
    },
  });

  console.log('Created sequence:', sequence._id.toString(), 'with sending_window:', sequence.sending_window);

  console.log('\n--- 2. Creating Sequence Step 0 (EMAIL) ---');
  const step = await SequenceStep.create({
    sequence_id: sequenceId,
    user_id: userId,
    step_index: 0,
    type: StepType.EMAIL,
    delay_days: 0,
    delay_hours: 0,
    is_active: true,
  });

  console.log('Created step 0:', step._id.toString(), 'with delay:', step.delay_days, 'days,', step.delay_hours, 'hours');

  console.log('\n--- 3. Activating Sequence ---');
  // Transition sequence status to Active (draft -> active)
  await sequenceService.transition(userId.toString(), sequenceId.toString(), { status: SequenceStatus.ACTIVE });

  console.log('\n--- 4. Enrolling Test Contact ---');
  const enrollResult = await enrollmentService.enroll(userId.toString(), sequenceId.toString(), {
    contacts: [
      {
        email: 'diagnostic-test@example.com',
        first_name: 'Diagnostic',
        last_name: 'Test',
        custom_variables: {},
      },
    ],
    skip_existing: true,
  });

  console.log('Enrollment result:', {
    enrolled: enrollResult.enrolled,
    skipped: enrollResult.skipped,
    failed: enrollResult.failed,
  });

  console.log('\n--- 5. Triggering Scheduler Tick via Queue ---');
  const conn = makeConnection();
  const schedulerQueue = new Queue('sequence-scheduler', { connection: conn });
  
  // Add scheduler:tick job to run the scheduler worker logic
  const job = await schedulerQueue.add('scheduler:tick', {}, {
    jobId: 'force-diagnostic-tick-' + Date.now(),
    removeOnComplete: true,
  });

  console.log('Enqueued scheduler tick job ID:', job.id);
  await schedulerQueue.close();

  // Wait a few seconds for the background worker to pick it up and write logs
  console.log('Waiting 5 seconds for worker to process...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('\n--- 6. Done ---');
}

run()
  .catch(err => {
    console.error('❌ Diagnostic run failed:', err);
    process.exit(1);
  })
  .finally(() => {
    mongoose.disconnect();
    process.exit(0);
  });
