import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { Sequence } from '../src/models/Sequence';

async function runAudit() {
  console.log('Connecting to database...');
  await mongoose.connect(env.MONGO_URI);
  console.log('Connected.');

  console.log('Running duplicate sequence name audit (case-insensitive)...');

  const sequences = await Sequence.find({}, 'user_id name').lean();
  
  const map = new Map<string, string[]>();
  let hasDuplicates = false;

  for (const seq of sequences) {
    const key = `${seq.user_id}_${seq.name.trim().toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(seq._id.toString());
  }

  for (const [key, ids] of map.entries()) {
    if (ids.length > 1) {
      hasDuplicates = true;
      const [userId, name] = key.split('_');
      console.log(`Duplicate found for user ${userId}: "${name}" (IDs: ${ids.join(', ')})`);
    }
  }

  if (!hasDuplicates) {
    console.log('No duplicate sequences found. Safe to apply unique index.');
  } else {
    console.log('Duplicates found! Please resolve them before applying the unique index.');
  }

  await mongoose.disconnect();
}

runAudit().catch(console.error);
