const { MongoClient, ObjectId } = require('mongodb');

async function main() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('email_sequencing');
  
  const failingStepId = new ObjectId('6a323381dd044c26b880aa77');
  const failingStep = await db.collection('sequence_steps').findOne({ _id: failingStepId });
  
  const workingStep = await db.collection('sequence_steps').findOne({ email_connection_id: { $exists: true } });
  
  console.log("--- FAILING STEP ---");
  console.log(JSON.stringify(failingStep, null, 2));
  
  console.log("\n--- WORKING STEP ---");
  console.log(JSON.stringify(workingStep, null, 2));
  
  await client.close();
}
main();
