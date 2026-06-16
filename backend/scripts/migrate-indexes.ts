/**
 * scripts/migrate-indexes.ts
 *
 * One-time script to create all MongoDB indexes defined in Mongoose schemas.
 *
 * Run with:
 *   npx ts-node scripts/migrate-indexes.ts
 *
 * Safe to re-run — MongoDB skips creation of already-existing indexes.
 */

import '../src/config/env'; // validate env first
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db';
import {
  EmailConnection,
  Template,
  Sequence,
  SequenceStep,
  SequenceContact,
  SendingLog,
  ReplyLog,
  BounceLog,
  OpenLog,
  ClickLog,
} from '../src/models';

const models = [
  { name: 'EmailConnection',  model: EmailConnection },
  { name: 'Template',         model: Template },
  { name: 'Sequence',         model: Sequence },
  { name: 'SequenceStep',     model: SequenceStep },
  { name: 'SequenceContact',  model: SequenceContact },
  { name: 'SendingLog',       model: SendingLog },
  { name: 'ReplyLog',         model: ReplyLog },
  { name: 'BounceLog',        model: BounceLog },
  { name: 'OpenLog',          model: OpenLog },
  { name: 'ClickLog',         model: ClickLog },
];

async function migrateIndexes(): Promise<void> {
  console.log('\n📦 Email Sequencing Module — Index Migration\n');
  console.log('━'.repeat(50));

  await connectDB();

  let totalCreated = 0;
  let totalFailed  = 0;

  for (const { name, model } of models) {
    try {
      process.stdout.write(`⏳ Syncing indexes for ${name.padEnd(20)}`);
      await model.syncIndexes();

      // List what was created
      const indexes = await model.collection.indexes();
      console.log(` ✅  (${indexes.length} index${indexes.length !== 1 ? 'es' : ''})`);

      if (process.env.VERBOSE === 'true') {
        indexes.forEach((idx) => {
          console.log(`     • ${JSON.stringify(idx.key)}`
            + (idx.unique ? ' [unique]' : '')
            + (idx.expireAfterSeconds !== undefined ? ' [TTL]' : '')
          );
        });
      }

      totalCreated++;
    } catch (err) {
      console.log(` ❌  ERROR`);
      console.error(`   ${(err as Error).message}`);
      totalFailed++;
    }
  }

  console.log('━'.repeat(50));
  console.log(`\n✅ Migration complete — ${totalCreated} models synced, ${totalFailed} failed\n`);

  if (totalFailed > 0) {
    console.error('⚠️  Some models failed index sync — review errors above.\n');
    await disconnectDB();
    process.exit(1);
  }

  await disconnectDB();
  process.exit(0);
}

migrateIndexes().catch((err) => {
  console.error('\n💀 Fatal migration error:', err.message);
  process.exit(1);
});
