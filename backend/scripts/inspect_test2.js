const mongoose = require('mongoose');

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/email_sequencing');
  const Sequence = mongoose.connection.collection('sequences');
  const SequenceContact = mongoose.connection.collection('sequence_contacts');

  const seq = await Sequence.findOne({ name: 'Penaldo' });
  if (!seq) {
    console.log('Penaldo sequence not found');
    process.exit(1);
  }

  const contacts = await SequenceContact.find({ sequence_id: seq._id }).toArray();
  
  let active = 0, completed = 0, paused = 0, dueNow = 0, future = 0;
  const staleLocks = [];
  const now = new Date();

  console.log(`\n=== REMAINING CONTACTS ===`);
  contacts.forEach(c => {
    if (c.status === 'completed') completed++;
    else if (c.status === 'active') active++;
    else if (c.status === 'paused') paused++;

    if (c.status === 'active') {
      if (c.next_send_at && c.next_send_at <= now) dueNow++;
      else if (c.next_send_at && c.next_send_at > now) future++;
      
      if (c.sending_locked) staleLocks.push(c._id);
      
      console.log(`- ${c.contact_email} | status: ${c.status} | step: ${c.current_step_index} | next: ${c.next_send_at ? c.next_send_at.toISOString() : 'null'} | locked: ${c.sending_locked}`);
    }
  });

  console.log(`\nTotal: ${contacts.length}`);
  console.log(`Completed: ${completed}`);
  console.log(`Active: ${active}`);
  console.log(`Pending: ${active}`); // assuming pending is active
  console.log(`Due now: ${dueNow}`);
  console.log(`Future scheduled: ${future}`);
  console.log(`Stale locks: ${staleLocks.length}`);
  
  console.log(`\n=== SENDING WINDOW ===`);
  console.log(JSON.stringify(seq.sending_window, null, 2));
  console.log(`Daily cap: ${seq.daily_sending_limit}`);

  const sampleFuture = contacts.find(c => c.status === 'active' && c.next_send_at > now);
  if (sampleFuture) {
    console.log(`\nnext_send_at (UTC): ${sampleFuture.next_send_at.toISOString()}`);
    console.log(`next_send_at (Asia/Calcutta): ${sampleFuture.next_send_at.toLocaleString('en-US', { timeZone: 'Asia/Calcutta' })}`);
  }

  process.exit(0);
}

main().catch(console.error);
