const { Queue } = require('bullmq');
const IORedis = require('ioredis');

async function test() {
  console.log('Testing connection drop with retryStrategy -> null');
  let attempt = 0;
  
  const connection = new IORedis({
    host: 'localhost',
    port: 9999, // intentionally wrong port to force connection failure
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
      attempt++;
      console.log(`Retry attempt ${times}`);
      if (times > 3) {
        console.log('Returning null from retryStrategy');
        return null;
      }
      return 100;
    }
  });

  connection.on('error', (err) => console.log('ioredis error:', err.message));
  connection.on('end', () => console.log('ioredis ended (permanently closed)'));
  connection.on('close', () => console.log('ioredis closed'));

  const queue = new Queue('test-queue', { connection });

  queue.on('error', (err) => console.log('queue error:', err.message));

  setTimeout(async () => {
    try {
      console.log('Attempting to enqueue job after connection ended...');
      await queue.add('test-job', { foo: 'bar' });
      console.log('Job enqueued successfully (should not happen)');
    } catch (err) {
      console.log('Enqueue failed as expected:', err.message);
    }
    process.exit(0);
  }, 1000);
}

test();
