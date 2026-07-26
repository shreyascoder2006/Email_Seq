const mongoose = require('mongoose');

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/email_sequencing');
  const Sequence = mongoose.connection.collection('sequences');
  const SequenceStep = mongoose.connection.collection('sequence_steps');
  const SequenceContact = mongoose.connection.collection('sequence_contacts');

  for (const name of ['Penaldo', 'Resignation']) {
    const seq = await Sequence.findOne({ name });
    if (!seq) {
      console.log(`\n--- Sequence: ${name} NOT FOUND ---`);
      continue;
    }
    
    const steps = await SequenceStep.countDocuments({ sequence_id: seq._id });
    
    console.log(`\n=== Sequence: ${name} ===`);
    console.log(`_id: ${seq._id}`);
    console.log(`status: ${seq.status}`);
    console.log(`sender/email connection: ${seq.email_connection_id}`);
    console.log(`number of steps: ${steps}`);
    
    const contacts = await SequenceContact.find({ sequence_id: seq._id }).toArray();
    console.log(`\nContacts count: ${contacts.length}`);
    
    if (contacts.length > 0) {
      const activeCount = contacts.filter(c => c.status === 'active').length;
      const pausedCount = contacts.filter(c => c.status === 'paused').length;
      const completedCount = contacts.filter(c => c.status === 'completed').length;
      
      console.log(`Statuses: Active=${activeCount}, Paused=${pausedCount}, Completed=${completedCount}`);
      
      // Dump a couple of contacts to see next_send_at vs current time
      const sample = contacts.find(c => c.status === 'active') || contacts[0];
      console.log(`Sample contact:`);
      console.log(`  current_step_index: ${sample.current_step_index}`);
      console.log(`  next_send_at: ${sample.next_send_at ? sample.next_send_at.toISOString() : 'null'}`);
      console.log(`  last_sent_at: ${sample.last_sent_at ? sample.last_sent_at.toISOString() : 'null'}`);
    }
  }
  
  console.log(`\nCURRENT SERVER TIME: ${new Date().toISOString()}`);
  process.exit();
}

main().catch(console.error);
