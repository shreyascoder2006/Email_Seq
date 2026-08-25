const mongoose = require('mongoose');
const { env } = require('./src/config/env');
const { analyticsService } = require('./src/services/analytics.service');

async function run() {
  try {
    await mongoose.connect(env.MONGO_URI);
    
    // I know this user ID has 566 sending logs
    const userId = '507f1f77bcf86cd799439011';
    
    console.log("Calling getRecentActivity...");
    const activity = await analyticsService.getRecentActivity(userId);
    
    console.log("Activity length:", activity.length);
    console.log("First item:", activity[0]);

  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

run();
