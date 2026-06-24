import mongoose from 'mongoose';
import { env } from './src/config/env';
import { EmailConnection } from './src/models/EmailConnection';
import { SequenceStep } from './src/models/SequenceStep';
import { Sequence } from './src/models/Sequence';

async function investigate() {
  await mongoose.connect(env.MONGO_URI);
  console.log('Connected to MongoDB');

  const oldConnectionId = '6a31082e6e3980a46178718e';

  // 1. Query the missing EmailConnection
  const oldConnection = await EmailConnection.findById(oldConnectionId).lean();
  console.log('1. Does it exist?', !!oldConnection);
  if (oldConnection) {
    console.log('   Is it active?', oldConnection.status);
    console.log('   Email:', oldConnection.from_email);
  } else {
    console.log('   The connection has been DELETED.');
    const { SendingLog } = await import('./src/models/SendingLog');
    const log = await SendingLog.findOne({ email_connection_id: oldConnectionId }).lean();
    if (log) {
      console.log('   Email found in SendingLog:', log.from_email);
    } else {
      console.log('   No SendingLogs found for this connection, cannot determine email.');
    }
  }

  // 2. Identify all SequenceSteps referencing this connection ID
  const steps = await SequenceStep.find({ email_connection_id: oldConnectionId }).lean();
  console.log(`\n2. Steps referencing ${oldConnectionId}: ${steps.length}`);
  
  const affectedSequences = new Set<string>();
  steps.forEach(s => {
    affectedSequences.add(s.sequence_id.toString());
    console.log(`   - Step ID: ${s._id}, Seq ID: ${s.sequence_id}, Index: ${s.step_index}`);
  });

  const sequences = await Sequence.find({ email_connection_id: oldConnectionId }).lean();
  console.log(`\n3. Sequences referencing ${oldConnectionId} directly: ${sequences.length}`);
  sequences.forEach(s => {
    affectedSequences.add(s._id.toString());
    console.log(`   - Seq ID: ${s._id}, Name: ${s.name}`);
  });

  // 4. Currently configured sender accounts
  const allConnections = await EmailConnection.find({}).lean();
  console.log(`\n4. Currently configured sender accounts: ${allConnections.length}`);
  allConnections.forEach(c => {
    console.log(`   - ID: ${c._id}, Email: ${c.from_email}, Status: ${c.status}`);
  });

  mongoose.disconnect();
}

investigate().catch(console.error);
