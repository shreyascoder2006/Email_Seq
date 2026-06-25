import mongoose from 'mongoose';
import { processEmailSend } from './src/queues/emailQueue';
import { env } from './src/config/env';

async function run() {
  await mongoose.connect(env.MONGO_URI);
  try {
    // Mock a BullMQ Job for sequenceContactId 6a323384dd044c26b880aa82
    const mockJob = {
      id: 'mock-1',
      name: 'email:send',
      data: {
        sequenceContactId: '6a323384dd044c26b880aa82',
        stepIndex: 0
      },
      timestamp: Date.now()
    } as any;

    await processEmailSend(mockJob);
    console.log('Force send complete!');
  } catch (err) {
    console.error('Force send failed:', err);
  } finally {
    await mongoose.disconnect();
  }
}
run();
