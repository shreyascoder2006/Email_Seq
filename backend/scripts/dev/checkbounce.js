const { MongoClient } = require('mongodb');
async function main() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('email_sequencing');

  const failed = await db.collection('sending_logs')
    .find({ status: { $in: ['failed', 'bounced'] } })
    .project({ status: 1, error_code: 1, error_message: 1, to_email: 1 })
    .limit(5)
    .toArray();
  console.log('failed/bounced sending_logs:', JSON.stringify(failed, null, 2));
  console.log('total failed:', await db.collection('sending_logs').countDocuments({ status: 'failed' }));
  console.log('total bounced:', await db.collection('sending_logs').countDocuments({ status: 'bounced' }));

  await client.close();
}
main().catch(console.error);
