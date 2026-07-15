const { MongoClient } = require('mongodb');
async function main() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('email_sequencing');
  const last = await db.collection('sending_logs')
    .find({ status: 'sent' })
    .sort({ sent_at: -1 })
    .limit(1)
    .project({ message_id: 1, sent_at: 1, body_html_snapshot: 1 })
    .toArray();
  if (last[0]) {
    console.log('sent_at:', last[0].sent_at);
    console.log('message_id:', last[0].message_id);
    const html = last[0].body_html_snapshot || '';
    const pixelMatch = html.match(/src=["'](http[^"']*\/p\/[^"']*)['"]/);
    console.log('pixel_url:', pixelMatch ? pixelMatch[1] : 'NOT FOUND IN HTML');
  } else {
    console.log('no sent logs found');
  }
  await client.close();
}
main().catch(console.error);
