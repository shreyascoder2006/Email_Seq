import mongoose from 'mongoose';
import { analyticsService } from './src/services/analytics.service';
import { Sequence } from './src/models/Sequence';
import { SendingLog } from './src/models/SendingLog';
import { OpenLog } from './src/models/OpenLog';
import { ClickLog } from './src/models/ClickLog';
import { ReplyLog } from './src/models/ReplyLog';
import { BounceLog } from './src/models/BounceLog';
import { SequenceContact } from './src/models/SequenceContact';

async function run() {
  await mongoose.connect('mongodb://localhost:27017/email_sequencing');
  console.log('Connected to DB');

  const seq = await Sequence.findOne();
  if (!seq) {
    console.log('No sequences found to test against.');
    process.exit(0);
  }
  const userId = seq.user_id.toString();
  const sequenceId = seq._id.toString();

  console.log(`\n--- INDEX AUDIT ---`);
  const collections = [Sequence, SendingLog, OpenLog, ClickLog, ReplyLog, BounceLog, SequenceContact];
  for (const model of collections) {
    const indexes = await model.collection.indexes();
    console.log(`\n${model.modelName} Indexes:`);
    indexes.forEach((idx: any) => console.log(`  ${idx.name}:`, JSON.stringify(idx.key)));
  }

  console.log(`\n--- EDGE CASE CHECKS (Div by Zero) ---`);
  const dash = await analyticsService.getEnhancedDashboard(userId, {});
  console.log('Dashboard Overview:', dash.overview);
  if (Object.values(dash.overview).some((v: any) => typeof v === 'number' && (Number.isNaN(v) || v < 0))) {
    console.log('ERROR: NaN or negative found in dashboard');
  } else {
    console.log('SUCCESS: No NaN or negative numbers in dashboard');
  }

  const seqMetrics = await analyticsService.getFullSequenceAnalytics(sequenceId, userId);
  console.log('Sequence Funnel:', seqMetrics.funnel);
  const f = seqMetrics.funnel;
  const funnelValid = f.enrolled >= f.sent && f.sent >= f.opened && f.opened >= f.clicked && f.clicked >= f.replied;
  console.log('Funnel Valid:', funnelValid);

  let stepSends = 0, stepOpens = 0, stepClicks = 0;
  seqMetrics.stepBreakdown.forEach((s: any) => {
    stepSends += s.sent; stepOpens += s.opens; stepClicks += s.clicks;
  });
  console.log('Step Totals:', { stepSends, stepOpens, stepClicks });
  console.log('Sequence Totals:', { sent: seqMetrics.emailsSent, opens: seqMetrics.opens, clicks: seqMetrics.clicks });
  
  if (stepSends === seqMetrics.emailsSent && stepOpens === seqMetrics.opens && stepClicks === seqMetrics.clicks) {
    console.log('SUCCESS: Step totals match sequence totals exactly.');
  } else {
    console.log('ERROR: Step totals do NOT match sequence totals!');
  }

  console.log(`\n--- PERFORMANCE / EXPLAIN PLAN ---`);
  const explain = await SendingLog.aggregate([
    { $match: { user_id: new mongoose.Types.ObjectId(userId) } },
    { $group: { _id: null, total: { $sum: 1 } } }
  ]).explain('executionStats') as any;
  
  const stats = explain[0]?.executionStats;
  const winningPlan = explain[0]?.queryPlanner?.winningPlan;
  
  if (stats) {
    console.log('SendingLog Aggregation Execution Time:', stats.executionTimeMillis, 'ms');
  }
  
  if (winningPlan) {
    let stage = winningPlan;
    let indexName = 'COLLSCAN';
    while (stage) {
      if (stage.indexName) {
        indexName = stage.indexName;
        break;
      }
      stage = stage.inputStage || (stage.inputStages ? stage.inputStages[0] : null);
    }
    console.log('Index used:', indexName);
  } else {
    console.log('Could not determine index from explain plan.');
  }

  process.exit(0);
}

run().catch(console.error);
