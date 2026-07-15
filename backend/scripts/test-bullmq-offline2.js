const { Queue } = require('bullmq');
const IORedis = require('ioredis');

async function test() {
  console.log('Testing enableOfflineQueue: false');
  
  const connection = new IORedis({
    host: 'localhost',
    port: 9999, // intentionally wrong port to force connection failure
    maxRetriesPerRequest: null,
    enableOfflineQueue: false, // <-- Circuit Breaker
    retryStrategy: (times) => 100 // retry forever
  });

  const queue = new Queue('test-queue', { connection });

  console.log('Attempting to enqueue job while Redis is down...');
  const start = Date.now();
  
  let isResolved = false;
  queue.add('test-job', { foo: 'bar' }).then(() => {
    isResolved = true;
    console.log(`Job enqueued successfully after ${Date.now() - start}ms`);
  }).catch((err) => {
    isResolved = true;
    console.log(`Enqueue failed after ${Date.now() - start}ms:`, err.message);
  });

  setTimeout(() => {
    console.log(`After 2 seconds, is resolved? ${isResolved}`);
    process.exit(0);
  }, 2000);
}

test();
