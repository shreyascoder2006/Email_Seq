const mongoose = require('mongoose');
const { env } = require('./src/config/env');
const { SendingLog } = require('./src/models/SendingLog');

async function run() {
  try {
    await mongoose.connect(env.MONGO_URI);
    
    const total = await SendingLog.countDocuments();
    const withUserId = await SendingLog.countDocuments({ user_id: { $exists: true, $ne: null } });
    const withSentAt = await SendingLog.countDocuments({ sent_at: { $exists: true, $ne: null } });
    const withSequenceId = await SendingLog.countDocuments({ sequence_id: { $exists: true, $ne: null } });
    const sample = await SendingLog.findOne().lean();

    console.log(JSON.stringify({
      total,
      withUserId,
      withSentAt,
      withSequenceId,
      sample
    }, null, 2));

  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

run();
