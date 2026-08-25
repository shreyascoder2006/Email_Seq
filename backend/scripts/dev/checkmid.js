const { MongoClient } = require('mongodb');
async function main() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('email_sequencing');
  
  // Check if the message_id exists in sending_logs
  const messageId = '<436de7c8-060c-4009-bbc3-782b66fcad37@gmail.com>';
  const found = await db.collection('sending_logs').findOne({ message_id: messageId });
  console.log('sending_log found by message_id:', found ? 'YES' : 'NO');
  
  // Also try without angle brackets
  const messageIdRaw = '436de7c8-060c-4009-bbc3-782b66fcad37@gmail.com';
  const foundRaw = await db.collection('sending_logs').findOne({ message_id: messageIdRaw });
  console.log('sending_log found without brackets:', foundRaw ? 'YES' : 'NO');
  
  // Check what message_id actually looks like in DB
  const sample = await db.collection('sending_logs').findOne({ status: 'sent' }, { projection: { message_id: 1 } });
  console.log('actual message_id in DB:', sample ? sample.message_id : 'none');
  
  await client.close();
}
main().catch(console.error);
