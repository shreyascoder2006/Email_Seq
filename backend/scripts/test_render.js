const mongoose = require('mongoose');
const { TemplateRenderer } = require('./src/utils/templateRenderer');
const { SequenceContact } = require('./src/models/SequenceContact');
const { SequenceStep } = require('./src/models/SequenceStep');

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/email_sequencing');
  const step = await SequenceStep.findOne({ subject_override: { $regex: 'Premium oat milk' } });
  const contact = await SequenceContact.findOne({ sequence_id: step.sequence_id });
  
  if (!step || !contact) {
    console.log('Could not find step or contact');
    process.exit();
  }

  try {
    const result = await TemplateRenderer.renderEmail({
      contactId: contact._id,
      stepId: step._id,
      sequenceId: step.sequence_id
    });
    console.log('--- Render Result ---');
    console.log('Subject:', result.subject);
    console.log('HTML:\\n', result.html);
    console.log('\\nMERGE TAG RENDERING SUCCESSFUL');
  } catch (err) {
    console.error('MERGE TAG RENDERING FAILED:', err);
  }

  process.exit();
}

main();
