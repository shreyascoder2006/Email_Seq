import './src/server';

setTimeout(() => {
  console.log('--- Triggering graceful shutdown (SIGINT) ---');
  process.emit('SIGINT');
}, 8000);
