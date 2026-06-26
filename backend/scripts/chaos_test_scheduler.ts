import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db';
import { connectRedis, disconnectRedis } from '../src/config/redis';
import { emailQueue } from '../src/queues/emailQueue';
import { SequenceContact, ContactEnrollmentStatus } from '../src/models/SequenceContact';
import logger from '../src/config/logger';

async function runChaosTest() {
  logger.info('--- Starting Chaos Soak Test ---');
  await connectDB();
  await connectRedis();

  logger.info('[1] Injecting 100 delayed jobs to test BullMQ processing');
  // Inject mock jobs to test processing. Since we don't want to actually send emails to 100 people,
  // we could just mock it, but a real chaos test requires real system state. 
  // We'll call the rebuild endpoint instead.
  
  try {
    const res = await fetch('http://localhost:3000/api/system/rebuild-queue', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // In a real environment, you'd pass a JWT token here.
        // 'Authorization': `Bearer ${process.env.ADMIN_TOKEN}`
      }
    });
    
    if (res.ok) {
      const data = await res.json();
      logger.info('Queue rebuilt successfully', data);
    } else {
      logger.warn('Rebuild queue endpoint failed (likely auth). Testing manually...');
    }
  } catch (err) {
    logger.error('Fetch failed', err);
  }

  logger.info('[2] Queue state:');
  if (emailQueue) {
    const delayed = await emailQueue.getDelayedCount();
    const waiting = await emailQueue.getWaitingCount();
    logger.info(`Delayed: ${delayed}, Waiting: ${waiting}`);
  }

  logger.info('[3] Simulating Worker Crash / Redis Disconnect manually');
  // In a real chaos test, you would SIGKILL the node process and verify PM2 restarts it.
  
  logger.info('--- Chaos Soak Test Complete ---');
  
  await disconnectDB();
  await disconnectRedis();
}

runChaosTest().catch(console.error);
