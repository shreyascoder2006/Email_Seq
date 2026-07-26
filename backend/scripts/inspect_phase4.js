const mongoose = require('mongoose');
const { runScheduler, getSchedulerQueue } = require('./src/queues/schedulerQueue');
const { SequenceContact } = require('./src/models/SequenceContact');
const { Queue, Worker, QueueEvents } = require('bullmq');

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/email_sequencing');
  
  const seq = await mongoose.connection.collection('sequences').findOne({ name: 'Penaldo' });
  let contact = await SequenceContact.findOne({ sequence_id: seq._id, status: 'active' });
  
  if (!contact) {
    console.log('No active contact found.');
    process.exit();
  }

  // FORCE ONE-CONTACT TEST
  console.log(`\n[PHASE 4] Modifying contact ${contact._id}...`);
  contact.next_send_at = new Date(Date.now() - 1000); // 1 second in the past
  contact.contact_email = 'shreyas.test@example.com';
  contact.sending_locked = false;
  await contact.save();
  
  console.log(`Contact modified! next_send_at=${contact.next_send_at.toISOString()}, sending_locked=${contact.sending_locked}`);

  // TRACE THE SCHEDULER
  console.log(`\n[PHASE 5] Triggering scheduler tick...`);
  // Initialize scheduler system temporarily
  const { startScheduler } = require('./src/queues/schedulerQueue');
  startScheduler();

  // Wait a few seconds for the scheduler to pick it up and process
  setTimeout(async () => {
    // Reload contact to see if sending_locked was changed
    const updatedContact = await SequenceContact.findById(contact._id);
    console.log(`\n[PHASE 7] sending_locked after scheduler: ${updatedContact.sending_locked}`);
    console.log(`locked_at: ${updatedContact.locked_at}`);
    
    // Check BullMQ for the enqueued job
    const emailQueue = new Queue('email-sequence', { connection: { host: '127.0.0.1', port: 6379 } });
    const waitingJobs = await emailQueue.getWaiting();
    const activeJobs = await emailQueue.getActive();
    
    console.log(`\n[PHASE 5] BullMQ Jobs Enqueued:`);
    const allJobs = [...waitingJobs, ...activeJobs];
    const myJob = allJobs.find(j => j.data.contactId === contact._id.toString());
    
    if (myJob) {
      console.log(`YES! Job Enqueued.`);
      console.log(`Queue name: email-sequence`);
      console.log(`Job ID: ${myJob.id}`);
      console.log(`Job name: ${myJob.name}`);
      console.log(`Job data:`, myJob.data);
      console.log(`Job state: await myJob.getState() =`, await myJob.getState());
    } else {
      console.log(`NO JOB FOUND IN BULLMQ FOR THIS CONTACT!`);
    }

    process.exit();
  }, 3000);
}

main().catch(console.error);
