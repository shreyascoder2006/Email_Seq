import mongoose from 'mongoose';
import { renderEmail } from '../src/utils/templateRenderer';
import { SequenceContact } from '../src/models/SequenceContact';
import { SequenceStep } from '../src/models/SequenceStep';

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/email_sequencing');
  const step = await SequenceStep.findOne({ subject_override: { $regex: 'Premium oat milk' } });
  const contact = await SequenceContact.findOne({ sequence_id: step!.sequence_id });
  
  if (!step || !contact) {
    console.log('Could not find step or contact');
    process.exit();
  }

  try {
    const result = renderEmail(
      {
        subject: step!.subject_override || '',
        body_html: step!.body_html_override || '',
        body_text: ''
      },
      {
        contact: contact as any,
        sender: { first_name: 'John', last_name: 'Doe' } as any,
        unsubscribeToken: 'test'
      }
    );
    console.log('--- Render Result ---');
    console.log('Subject:', result.subject);
    console.log('HTML:\n', result.body_html);
    console.log('\nMERGE TAG RENDERING SUCCESSFUL');
  } catch (err) {
    console.error('MERGE TAG RENDERING FAILED:', err);
  }

  process.exit();
}

main();
