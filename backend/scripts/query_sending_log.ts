import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  const uri = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/email_sequencing').replace('localhost', '127.0.0.1');
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const { SendingLog } = require('../src/models/SendingLog');
  
  const failedLogs = await SendingLog.find({ status: 'failed' }).sort({ failed_at: -1 }).limit(10);
  console.log(`Found ${failedLogs.length} failed logs.`);
  
  for (const log of failedLogs) {
    console.log(`\n--- Log ${log._id} ---`);
    console.log(`From: ${log.from_email}`);
    console.log(`To: ${log.to_email}`);
    console.log(`Status: ${log.status}`);
    console.log(`Error: ${log.error_message}`);
  }
  
  process.exit(0);
}

run();
