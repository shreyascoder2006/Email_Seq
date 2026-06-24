const mongoose = require('mongoose');
const { Types } = mongoose;
const { env } = require('./src/config/env');
const { SendingLog } = require('./src/models/SendingLog');

async function run() {
  try {
    await mongoose.connect(env.MONGO_URI);
    
    // Hardcode current logged in user ID for testing. 
    const currentUserId = new Types.ObjectId('6a323381dd044c26b880aa5c');
    
    const countForCurrentUser = await SendingLog.countDocuments({ user_id: currentUserId });
    const countSentDelivered = await SendingLog.countDocuments({ user_id: currentUserId, status: { $in: ['sent', 'delivered'] } });
    
    console.log("Count for current user ID:", countForCurrentUser);
    console.log("Count for current user ID (sent/delivered):", countSentDelivered);

  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

run();
