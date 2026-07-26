import axios from 'axios';
import mongoose from 'mongoose';
import { Sequence } from '../src/models/Sequence';
import { SequenceContact } from '../src/models/SequenceContact';
import { SequenceStep } from '../src/models/SequenceStep';

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1MDdmMWY3N2JjZjg2Y2Q3OTk0MzkwMTEiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJpYXQiOjE3ODUwNzU5MzAsImV4cCI6MTc4NTA3OTUzMH0.27I4Htp2QApPH-KkXFO96d7OUXjgzp_2dHt9nGPhemQ';
const API_URL = 'http://localhost:5001/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    Authorization: `Bearer ${TOKEN}`
  }
});

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/email_sequencing');

  try {
    // Get existing email connection to use via DB
    const conn = await mongoose.connection.collection('email_connections').findOne({});
    const connectionId = conn!._id.toString();
    
    // Get existing template to use via DB
    const tmpl = await mongoose.connection.collection('templates').findOne({});
    const templateId = tmpl!._id.toString();

    // 1. Create Sequence
    console.log('[API] Creating new sequence...');
    const createRes = await api.post('/sequences', {
      name: `Test E2E Sequence ${Date.now()}`,
      email_connection_id: connectionId,
      launch_date: new Date().toISOString(),
      sending_window: {
        timezone: "Asia/Calcutta",
        schedule: "custom",
        start_hour: 19,
        start_minute: 30,
        end_hour: 20,
        end_minute: 0,
        custom_days: [0, 1, 2, 3, 4, 5, 6]
      }
    });
    const seqId = createRes.data.data._id;
    console.log(`[API] Sequence Created: ${seqId}`);

    // 2. Add Step
    console.log('[API] Adding step...');
    await api.post(`/sequences/${seqId}/steps`, {
      type: "email",
      template_id: templateId,
      delay_days: 0,
      delay_hours: 0,
      subject_override: "Brand New Sequence Subject",
      body_html_override: "<p>Brand New Body</p>"
    });

    // 3. Enroll Contact
    console.log('[API] Enrolling contact...');
    await api.post(`/sequences/${seqId}/enroll`, {
      contacts: [
        {
          email: "shreyas.test_new_seq@example.com",
          first_name: "Test",
          last_name: "User",
          company: "Example Inc"
        }
      ]
    });

    // 4. Launch Sequence
    console.log('[API] Launching sequence...');
    try {
      await api.patch(`/sequences/${seqId}/status`, {
        status: "active",
        send_immediately: true
      });
      console.log('[API] Launch successful');
    } catch (e: any) {
      console.error('[API] Launch failed:', e.response?.data || e.message);
    }

    console.log('[API] Waiting 10 seconds for jobs to process...');
    await new Promise(r => setTimeout(r, 10000));

    // --- DB INSPECTION ---
    console.log('\n==================================================');
    console.log('PHASE 1 — TRACE A BRAND-NEW SEQUENCE');
    console.log('==================================================\n');

    const seq = await Sequence.findById(seqId).lean();
    console.log('--- SEQUENCE DOCUMENT ---');
    console.log(`_id: ${seq?._id}`);
    console.log(`status: ${seq?.status}`);
    console.log(`sender_connection_id: ${seq?.email_connection_id}`);
    console.log(`sending_window:`, JSON.stringify(seq?.sending_window));
    console.log(`timezone: ${seq?.sending_window?.timezone}`);
    console.log(`daily_sending_limit: ${seq?.daily_sending_limit}`);

    const contacts = await SequenceContact.find({ sequence_id: seqId }).lean();
    console.log('\n--- SEQUENCE CONTACTS ---');
    for (const c of contacts) {
      console.log(`_id: ${c._id}`);
      console.log(`contact_email: ${c.contact_email}`);
      console.log(`status: ${c.status}`);
      console.log(`current_step_index: ${c.current_step_index}`);
      console.log(`next_send_at: ${c.next_send_at ? c.next_send_at.toISOString() : 'null'}`);
      console.log(`sending_locked: ${c.sending_locked}`);
      console.log(`job_state: ${c.job_state}`);
    }

    const steps = await SequenceStep.find({ sequence_id: seqId }).lean();
    console.log('\n--- SEQUENCE STEPS ---');
    for (const s of steps) {
      console.log(`_id: ${s._id}`);
      console.log(`step_index: ${s.step_index}`);
      console.log(`template_id: ${s.template_id}`);
      console.log(`subject_override: ${s.subject_override}`);
    }

  } catch (err: any) {
    console.error('Test failed:', err.response?.data || err.message);
  } finally {
    process.exit(0);
  }
}

main();
