import { enqueueEmailJob } from './src/queues/emailQueue';

async function test() {
  console.log('Testing enqueueEmailJob circuit breaker...');
  try {
    await enqueueEmailJob('contact1', 0, new Date(), 'seq1', 1, 'test');
    console.log('Success');
  } catch (err: any) {
    console.log('Caught error:', err?.message);
  }
  process.exit(0);
}

test();
