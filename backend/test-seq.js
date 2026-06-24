const mongoose = require('mongoose');
const { env } = require('./src/config/env');
const { Sequence } = require('./src/models/Sequence');

async function run() {
  try {
    await mongoose.connect(env.MONGO_URI);
    
    const seqs = await Sequence.find({ user_id: '6a323381dd044c26b880aa5c' }).lean();
    console.log(JSON.stringify(seqs, null, 2));

  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

run();
