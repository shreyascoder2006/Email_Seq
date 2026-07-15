const { MongoClient, ObjectId } = require('mongodb');
async function main() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('email_sequencing');
  
  // Get a real open_log row
  const openLog = await db.collection('open_logs').findOne({});
  console.log('sample open_log:', JSON.stringify(openLog, null, 2));
  
  // Check the sequence it points to
  if (openLog?.sequence_id) {
    const seq = await db.collection('sequences').findOne(
      { _id: openLog.sequence_id },
      { projection: { name: 1, stats: 1 } }
    );
    console.log('linked sequence:', JSON.stringify(seq, null, 2));
  }
  
  // Check the sending_log it points to
  if (openLog?.sending_log_id) {
    const sl = await db.collection('sending_logs').findOne(
      { _id: openLog.sending_log_id },
      { projection: { sequence_id: 1, status: 1, to_email: 1 } }
    );
    console.log('linked sending_log:', JSON.stringify(sl, null, 2));
  }

  await client.close();
}
main().catch(console.error);
