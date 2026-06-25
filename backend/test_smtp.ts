import mongoose from 'mongoose';
import { emailConnectionService } from './src/services/emailConnection.service';
import { env } from './src/config/env';

async function run() {
  await mongoose.connect(env.MONGO_URI);
  try {
    const result = await emailConnectionService.testConnection('507f1f77bcf86cd799439011', '6a3398bba1a37587de83a398', true);
    console.log('Outreach (amol@cloudslead.com):', JSON.stringify(result, null, 2));

    const result2 = await emailConnectionService.testConnection('507f1f77bcf86cd799439011', '6a30f7746e3980a461787104', true);
    console.log('Marketing (amol@cloudoauth.info):', JSON.stringify(result2, null, 2));

  } finally {
    await mongoose.disconnect();
  }
}
run().catch(console.error);
