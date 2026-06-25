import mongoose from 'mongoose';
import { env } from '../src/config/env';

import { Sequence } from '../src/models/Sequence';
import { SequenceStep, StepType } from '../src/models/SequenceStep';
import { SequenceContact } from '../src/models/SequenceContact';
import { EmailConnection, ConnectionStatus } from '../src/models/EmailConnection';
import { Template } from '../src/models/Template';

const isApply = process.argv.includes('--apply');

async function main() {
  console.log(`Starting Repair Legacy Sequences script in ${isApply ? 'APPLY' : 'DRY-RUN'} mode...\n`);

  if (!env.MONGO_URI) {
    console.error('MONGO_URI is not defined in environment variables.');
    process.exit(1);
  }

  await mongoose.connect(env.MONGO_URI);
  console.log('Connected to MongoDB.\n');

  const sequences = await Sequence.find({});
  let totalScanned = 0;

  const stats = {
    mismatched_step_ownership: 0,
    mismatched_contact_ownership: 0,
    missing_email_connection_id: 0,
    missing_template_id: 0,
    missing_template_reference: 0,
    missing_sender_accounts: 0,
  };

  const fixes = {
    fixed_step_ownership: 0,
    fixed_contact_ownership: 0,
    fixed_step_email_connection: 0,
    fixed_sequence_email_connection: 0,
  };

  let skipped = 0;

  for (const seq of sequences) {
    totalScanned++;
    const seqId = seq._id;
    const userId = seq.user_id;

    let needsSaveSeq = false;

    // Load relationships
    const steps = await SequenceStep.find({ sequence_id: seqId });
    const contacts = await SequenceContact.find({ sequence_id: seqId });
    const connections = await EmailConnection.find({ user_id: userId, status: ConnectionStatus.ACTIVE }).lean();
    const activeConnections = new Set(connections.map(c => c._id.toString()));

    const templates = await Template.find({ user_id: userId, is_archived: false }).lean();
    const activeTemplates = new Set(templates.map(t => t._id.toString()));

    // 1. Contact Ownership Mismatch
    for (const contact of contacts) {
      if (contact.user_id.toString() !== userId.toString()) {
        stats.mismatched_contact_ownership++;
        console.log(`[Issue] Contact ${contact._id} has user_id ${contact.user_id}, expected ${userId}`);
        if (isApply) {
          contact.user_id = userId;
          await contact.save();
          fixes.fixed_contact_ownership++;
        }
      }
    }

    // 2. Step Analysis & Ownership
    for (const step of steps) {
      let needsSaveStep = false;
      let ambiguousSender = false;

      if (step.user_id.toString() !== userId.toString()) {
        stats.mismatched_step_ownership++;
        console.log(`[Issue] Step ${step._id} has user_id ${step.user_id}, expected ${userId}`);
        if (isApply) {
          step.user_id = userId;
          needsSaveStep = true;
          fixes.fixed_step_ownership++;
        }
      }

      if (step.type === StepType.EMAIL) {
        // Missing Template
        if (!step.template_id) {
          stats.missing_template_id++;
          console.log(`[Issue] Step ${step._id} is missing template_id. Requires manual review.`);
          skipped++;
        } else if (!activeTemplates.has(step.template_id.toString())) {
          stats.missing_template_reference++;
          console.log(`[Issue] Step ${step._id} refers to invalid/archived template ${step.template_id}. Requires manual review.`);
          skipped++;
        }

        // Missing Sender
        const stepConnId = (step as any).email_connection_id;
        const seqConnId = seq.email_connection_id;

        if (!stepConnId) {
          stats.missing_email_connection_id++;
          console.log(`[Issue] Step ${step._id} is missing email_connection_id.`);
          
          if (seqConnId) {
            console.log(`  -> Auto-repair: Copying sequence default ${seqConnId} to step.`);
            if (isApply) {
              (step as any).email_connection_id = seqConnId;
              needsSaveStep = true;
              fixes.fixed_step_email_connection++;
            }
          } else {
            // Sequence also lacks it. Let's see if user has exactly one active connection.
            if (connections.length === 1) {
              const onlyConnId = connections[0]._id;
              console.log(`  -> Auto-repair: User has exactly 1 active connection. Assigning ${onlyConnId} to sequence and step.`);
              if (isApply) {
                seq.email_connection_id = onlyConnId;
                needsSaveSeq = true;
                (step as any).email_connection_id = onlyConnId;
                needsSaveStep = true;
                fixes.fixed_sequence_email_connection++;
                fixes.fixed_step_email_connection++;
              }
            } else {
              console.log(`  -> Cannot auto-repair: User has ${connections.length} active connections. Requires manual review.`);
              ambiguousSender = true;
              skipped++;
            }
          }
        } else if (!activeConnections.has(stepConnId.toString())) {
          stats.missing_sender_accounts++;
          console.log(`[Issue] Step ${step._id} refers to invalid/inactive connection ${stepConnId}. Requires manual review.`);
          skipped++;
        }
      }

      if (needsSaveStep && isApply) {
        await step.save();
      }
    }

    if (needsSaveSeq && isApply) {
      await seq.save();
    }
  }

  console.log('\n=======================================');
  console.log('             REPAIR REPORT             ');
  console.log('=======================================');
  console.log(`Sequences scanned: ${totalScanned}`);
  console.log('\nIssues Found:');
  console.table(stats);
  
  if (isApply) {
    console.log('\nFixes Applied:');
    console.table(fixes);
  } else {
    console.log('\nRun with --apply to execute safe auto-repairs.');
  }

  console.log(`\nItems skipped (manual review required): ${skipped}`);
  console.log('=======================================\n');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
