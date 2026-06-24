const mongoose = require('mongoose');
const { SequenceStep } = require('./src/models/SequenceStep');

async function main() {
  await mongoose.connect('mongodb://localhost:27017/email_sequencing');
  const steps = await SequenceStep.find().sort({ _id: -1 }).limit(3).lean();
  console.log(JSON.stringify(steps, null, 2));
  process.exit(0);
}
main();
