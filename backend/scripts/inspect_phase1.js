const mongoose = require('mongoose');

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/email_sequencing');
  const Sequence = mongoose.connection.collection('sequences');
  const SequenceContact = mongoose.connection.collection('sequence_contacts');

  for (const name of ['Penaldo', 'Resignation']) {
    const seq = await Sequence.findOne({ name });
    if (!seq) {
      console.log(`\n--- Sequence: ${name} NOT FOUND ---`);
      continue;
    }
    
    console.log(`\n=== Sequence: ${name} ===`);
    console.log(`1. sequence.status: ${seq.status}`);
    console.log(`2. sending_window:`, JSON.stringify(seq.sending_window));
    console.log(`3. timezone: ${seq.sending_window ? seq.sending_window.timezone : 'None'}`);
    
    const contacts = await SequenceContact.find({ sequence_id: seq._id }).toArray();
    console.log(`4. total SequenceContacts: ${contacts.length}`);
    
    if (contacts.length > 0) {
      const activeCount = contacts.filter(c => c.status === 'active').length;
      const pausedCount = contacts.filter(c => c.status === 'paused').length;
      const completedCount = contacts.filter(c => c.status === 'completed').length;
      
      console.log(`5. active contacts: ${activeCount}`);
      console.log(`6. paused contacts: ${pausedCount}`);
      console.log(`7. completed contacts: ${completedCount}`);
      
      console.log(`8. next_send_at for at least 3 contacts:`);
      for (let i = 0; i < Math.min(3, contacts.length); i++) {
        console.log(`   - ${contacts[i]._id}: ${contacts[i].next_send_at ? contacts[i].next_send_at.toISOString() : 'null'}`);
      }
      
      console.log(`9. sending_locked for 3 contacts:`);
      for (let i = 0; i < Math.min(3, contacts.length); i++) {
        console.log(`   - ${contacts[i]._id}: ${contacts[i].sending_locked}`);
      }
      
      const now = new Date();
      console.log(`10. current UTC time: ${now.toISOString()}`);
      
      // Calculate sequence local time
      const tz = seq.sending_window ? seq.sending_window.timezone : 'UTC';
      const localTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      console.log(`11. current sequence-local time (${tz}): ${localTime.toISOString()}`);
      
      console.log(`12. whether each inspected contact is ACTUALLY due now:`);
      for (let i = 0; i < Math.min(3, contacts.length); i++) {
        const due = contacts[i].next_send_at && contacts[i].next_send_at <= now;
        console.log(`   - ${contacts[i]._id}: ${due ? 'YES' : 'NO'}`);
      }
    }
  }
  
  process.exit();
}

main().catch(console.error);
