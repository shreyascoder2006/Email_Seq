const { MongoClient } = require('mongodb');
async function main() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('email_sequencing');
  const seqs = await db.collection('sequences')
    .find({})
    .project({ name: 1, 'stats.opens': 1, 'stats.clicks': 1 })
    .toArray();
  seqs.forEach(s => console.log(s.name, '| opens:', s.stats?.opens ?? 0, '| clicks:', s.stats?.clicks ?? 0));
  await client.close();
}
main().catch(console.error);
