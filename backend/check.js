const { MongoClient } = require('mongodb');
async function main() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('email_sequencing');
  const ol = await db.collection('open_logs').countDocuments();
  const cl = await db.collection('click_logs').countDocuments();
  console.log('open_logs:', ol);
  console.log('click_logs:', cl);
  await client.close();
}
main().catch(console.error);
