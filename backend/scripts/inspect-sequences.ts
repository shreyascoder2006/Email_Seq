import mongoose from 'mongoose';
import { Sequence } from '../src/models/Sequence';
import { SequenceContact } from '../src/models/SequenceContact';
import { SequenceStep } from '../src/models/SequenceStep';
import { EmailConnection } from '../src/models/EmailConnection';
import { env } from '../src/config/env';

async function main() {
  await mongoose.connect(env.MONGO_URI);
  console.log('Connected\n');

  const seqs = await Sequence.find({ status: { $in: ['draft', 'active', 'paused'] } })
    .select('_id name status email_connection_id sending_window launch_date')
    .limit(10).lean();

  for (const s of seqs) {
    const contactCount = await SequenceContact.countDocuments({ sequence_id: s._id, status: 'active' });
    const steps = await SequenceStep.find({ sequence_id: s._id })
      .select('type email_connection_id template_id is_active')
      .lean();

    console.log('SEQ:', JSON.stringify({
      id: s._id.toString(),
      name: s.name,
      status: s.status,
      seq_email_conn: s.email_connection_id?.toString() || null,
      window: s.sending_window,
      activeContacts: contactCount,
      steps: steps.map(st => ({
        type: st.type,
        hasConn: !!st.email_connection_id,
        connId: (st as any).email_connection_id?.toString() || null,
        hasTemplate: !!(st as any).template_id,
        active: st.is_active
      }))
    }, null, 2));
  }

  // Also show first 3 active contacts
  const contacts = await SequenceContact.find({ status: 'active' }).limit(3).lean();
  console.log('\nSAMPLE ACTIVE CONTACTS:');
  contacts.forEach(c => console.log(JSON.stringify({
    id: c._id.toString(),
    seq: c.sequence_id.toString(),
    email: c.contact_email,
    step: c.current_step_index,
    next_send_at: c.next_send_at?.toISOString() || null
  })));

  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
