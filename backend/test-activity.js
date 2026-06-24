const mongoose = require('mongoose');
const { Types } = mongoose;
const { env } = require('./src/config/env');
const { SendingLog } = require('./src/models/SendingLog');
const { Sequence } = require('./src/models/Sequence');

async function run() {
  try {
    await mongoose.connect(env.MONGO_URI);
    
    // Hardcode a user ID for testing. The user ID from previous log: '507f1f77bcf86cd799439011'
    const userObjectId = new Types.ObjectId('507f1f77bcf86cd799439011');
    
    const sentLogs = await SendingLog.find({ user_id: userObjectId, status: { $in: ['sent', 'delivered'] } })
        .sort({ sent_at: -1 })
        .limit(50)
        .select('to_email sent_at sequence_id')
        .lean();

    console.log("SentLogs:", JSON.stringify(sentLogs, null, 2));

  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

run();
