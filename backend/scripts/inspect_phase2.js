const Redis = require('ioredis');
const { Queue } = require('bullmq');

async function main() {
  console.log('Testing Redis...');
  const redis = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1 });
  
  try {
    const ping = await redis.ping();
    console.log('Redis status: CONNECTED (', ping, ')');
  } catch (err) {
    console.log('Redis status: DISCONNECTED', err.message);
    process.exit(1);
  }

  console.log('\nChecking queues...');
  const schedQueue = new Queue('sequence-scheduler', { connection: redis });
  const emailQueue = new Queue('email-sequence', { connection: redis });

  const schedCounts = await schedQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  console.log('sequence-scheduler queue:', schedCounts);

  const emailCounts = await emailQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  console.log('email-sequence queue:', emailCounts);

  const failedJobs = await emailQueue.getFailed();
  if (failedJobs.length > 0) {
    console.log('\nFailed email jobs:');
    failedJobs.slice(0, 3).forEach(job => {
      console.log(`- Job ${job.id}: ${job.failedReason}`);
    });
  }

  process.exit(0);
}
main().catch(console.error);
