const mongoose = require('mongoose');

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/email_sequencing');
  const Sequence = mongoose.connection.collection('sequences');
  const SequenceContact = mongoose.connection.collection('sequence_contacts');

  const seq = await Sequence.findOne({ name: 'Penaldo' });
  const contact = await SequenceContact.findOne({ sequence_id: seq._id, status: 'active' });

  if (!contact) {
    console.log('No active contact found.');
    process.exit();
  }

  // FORCE ONE-CONTACT TEST for recurring scheduler
  console.log(`\n[PHASE 6] Modifying contact ${contact._id}...`);
  await SequenceContact.updateOne(
    { _id: contact._id },
    { 
      $set: { 
        next_send_at: new Date(Date.now() - 10000), // 10 seconds in the past
        contact_email: 'shreyas.test2@example.com',
        sending_locked: false 
      }
    }
  );
  
  console.log(`Contact modified! Waiting for the 5-minute recurring scheduler tick...`);

  // Poll DB to check when the job completes
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes max wait (60 * 5s = 300s)
  
  const interval = setInterval(async () => {
    attempts++;
    const updated = await SequenceContact.findOne({ _id: contact._id });
    
    console.log(`Polling... attempt ${attempts}. Status: ${updated.status}, Locked: ${updated.sending_locked}`);
    
    if (updated.status === 'completed') {
      console.log(`\nSUCCESS! Contact sent via automatic scheduler!`);
      const logs = await mongoose.connection.collection('sending_logs').find({ sequence_contact_id: contact._id }).toArray();
      console.log(`Sending log status: ${logs.length ? logs[0].status : 'none'}`);
      
      const seqAfter = await Sequence.findOne({ _id: seq._id });
      console.log(`\nSequence Sent Count: ${seqAfter.stats.total_sent}`);
      console.log(`Sequence Pending Count: ${seqAfter.stats.active_contacts}`);
      
      clearInterval(interval);
      process.exit(0);
    }
    
    if (attempts >= maxAttempts) {
      console.log(`\nTIMEOUT waiting for scheduler.`);
      clearInterval(interval);
      process.exit(1);
    }
  }, 5000);
}

main().catch(console.error);
