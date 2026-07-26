const mongoose = require('mongoose');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/email_sequencing');
  const db = mongoose.connection;
  
  const sundayId = new mongoose.Types.ObjectId('6a661c30a22f74c9b6f4e3f5');
  
  const sunday = await db.collection('sequences').findOne({ _id: sundayId });
  const sampleContact = await db.collection('sequence_contacts').findOne({ sequence_id: sundayId });
  
  const enrolledAt = new Date(sampleContact.enrolled_at);
  const contactUpdatedAt = new Date(sampleContact.updated_at);
  const seqActivatedAt = new Date(sunday.updated_at);
  const seqCreatedAt = new Date(sunday.created_at);
  
  console.log('Sunday created_at:           ', seqCreatedAt.toISOString());
  console.log('Contact enrolled_at:          ', enrolledAt.toISOString());
  console.log('Contact updated_at:           ', contactUpdatedAt.toISOString());
  console.log('Sunday sequence updated_at:   ', seqActivatedAt.toISOString());
  console.log('');
  console.log('Time from creation to enrollment:', ((enrolledAt - seqCreatedAt) / 1000).toFixed(1), 'seconds');
  console.log('Time from enrollment to activation:', ((seqActivatedAt - enrolledAt) / 1000 / 60).toFixed(1), 'minutes');
  
  // What was Sunday status at time of enrollment?
  // Sunday was CREATED (draft) -> contacts enrolled -> then activated
  // At enrollment time, Sunday status was likely "paused" or "draft" (sequence validator)
  // The enrollment service should have determined next_send_at based on the sending_window
  
  // Let's look at enrollment service to understand what next_send_at was set during enrollment
  // The key: next_send_at = 2026-07-27T10:00:00.000Z = tomorrow 15:30 IST = first available slot
  
  // This means activation did NOT update any contacts.
  // Either:
  // 1. The activation updateMany did not match any contacts (contact filter issue)
  // 2. The from state was already "active" so the transition bypassed the normal path and went into active→active re-launch path
  // 3. There was an error that swallowed the exception
  
  console.log('\nIs from = active → active path possible?');
  console.log('Sequence created_at == sequence updated_at?', seqCreatedAt.toISOString() === seqActivatedAt.toISOString());
  // If Sunday was activated then paused then re-activated, or if there was any prior status change
  
  // Check sequence history - look at __v (Mongoose version key) to see if it was modified multiple times
  console.log('Mongoose __v (version):', sunday.__v);
  console.log('');
  
  // IMPORTANT: Check what was the sequence status BEFORE the final activation
  // We know:
  // - created_at: 14:39:44 UTC
  // - contact enrolled_at: 14:40:16 UTC (32 seconds after creation)
  // - sequence updated_at: 15:02:25 UTC (22 minutes after creation)
  // 
  // The 22 minute gap means the user created sequence, enrolled contacts, THEN activated 22 minutes later
  // In those 22 minutes, the sequence was in draft/paused state
  // The enrollment service computed next_send_at based on sending window
  //
  // QUESTION: What was the sequence status when contacts were enrolled?
  // ANSWER: The sequence was in PAUSED or DRAFT status (not yet activated)
  
  // Now the KEY BUG: 
  // In SequencePreviewTestPage, when the user clicks "Launch Campaign":
  // The frontend calls: sequenceService.activate(id, sendImmediately)
  // Which calls: PATCH /sequences/:id/status { status: 'active', send_immediately: true }
  //
  // In sequence.service.ts, the transition() function:
  // Line 330: if (from === to) -> runs the active→active re-launch path
  //   BUT WAIT - if sequence was in "paused" state and being activated, from = "paused", to = "active"
  //   That's NOT equal, so it goes to the NORMAL activation path (line 415)
  //   The normal path should run updateMany with isImmediate=true
  
  // So why didn't it work for Sunday?
  // Let's check: was Sunday previously activated and then paused?
  // __v = 0 means document was never versioned... but that might not tell us
  
  console.log('Looking for possible prior state changes...');
  console.log('sequence __v:', sunday.__v);
  
  // Check if the send_immediately flag actually reaches the controller from the frontend
  // The frontend in SequencePreviewTestPage calls:
  //   onLaunch(sendImmediately)
  // which calls sequenceService.activate(id, sendImmediately)
  // which sends: { status: 'active', ...(sendImmediately && { send_immediately: true }) }
  //
  // The spread syntax: ...(false && { send_immediately: true }) = {} (empty)
  //                   ...(true && { send_immediately: true }) = { send_immediately: true }
  //
  // If sendImmediately is FALSE (checkbox unchecked), send_immediately is NOT sent
  // The backend dto.send_immediately would be undefined → isImmediate = false
  //
  // THE KEY QUESTION: Was the "Send first email immediately" checkbox CHECKED when Sunday was launched?
  
  console.log('\nKEY QUESTION: Was send_immediately=true sent for Sunday?');
  console.log('');
  console.log('Evidence:');
  console.log('- Contact next_send_at = 2026-07-27T10:00:00.000Z (tomorrow 15:30 IST)');
  console.log('- This is the WINDOW-BASED calculated next slot, not "now"');
  console.log('- If send_immediately=true had worked, next_send_at would be around 15:02 UTC (activation time)');
  console.log('- The activation timestamp is 15:02:25 UTC');
  console.log('- next_send_at was set at ENROLLMENT time (14:40) not at ACTIVATION time (15:02)');
  console.log('');
  console.log('CONCLUSION: send_immediately=true DID NOT UPDATE the contacts next_send_at');
  console.log('Either:');
  console.log('  A) send_immediately was false (checkbox was unchecked)');
  console.log('  B) send_immediately=true was sent but the updateMany filter matched 0 contacts');
  console.log('  C) The activation code path was different (e.g. already-active branch)');
  
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
