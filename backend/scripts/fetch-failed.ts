import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Queue } from 'bullmq';

const queue = new Queue('email-queue', {
  connection: {
    host: '127.0.0.1',
    port: 6379
  }
});

async function run() {
  const failed = await queue.getFailed(0, 5);
  console.log(`Found ${failed.length} failed jobs.`);
  
  for (const job of failed) {
      console.log(`\n--- Job ${job.id} ---`);
      console.log(`Data:`, job.data);
      console.log(`Failed Reason:`, job.failedReason);
  }
  
  process.exit(0);
}

run();
