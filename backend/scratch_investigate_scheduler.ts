import { Queue } from 'bullmq';
import { env } from './src/config/env';

async function investigate() {
  console.log("Next execution:", new Date(1781772600000).toISOString());
  console.log("Current UTC time:", new Date().toISOString());

  const queue = new Queue('sequence-scheduler', {
    connection: {
      host: 'localhost',
      port: 6379,
    }
  });

  const waiting = await queue.getWaitingCount();
  const active = await queue.getActiveCount();
  const completed = await queue.getCompletedCount();
  const failed = await queue.getFailedCount();
  const delayed = await queue.getDelayedCount();

  console.log('Scheduler Queue Counts:');
  console.log({ waiting, active, completed, failed, delayed });

  const activeJobs = await queue.getJobs(['active']);
  console.log('Active Jobs:', activeJobs.map(j => ({ id: j.id, name: j.name, timestamp: j.timestamp })));

  const delayedJobs = await queue.getJobs(['delayed']);
  console.log('Delayed Jobs:', delayedJobs.map(j => ({ id: j.id, name: j.name, timestamp: j.timestamp, processedOn: j.processedOn, delay: j.delay })));

  const failedJobs = await queue.getJobs(['failed']);
  console.log('Failed Jobs:', failedJobs.map(j => ({ id: j.id, name: j.name, failedReason: j.failedReason })));

  process.exit(0);
}

investigate().catch(console.error);
