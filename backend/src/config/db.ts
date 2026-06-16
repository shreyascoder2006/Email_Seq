import mongoose from 'mongoose';
import logger from './logger';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/email_sequencing';
const MAX_POOL_SIZE = parseInt(process.env.MONGO_MAX_POOL_SIZE || '10', 10);

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

let retryCount = 0;

// ─── Mongoose event listeners ──────────────────────────────────────
mongoose.connection.on('connected', () => {
  logger.info('✅ MongoDB connected', { uri: MONGO_URI.split('@').pop() });
  retryCount = 0;
});

mongoose.connection.on('disconnected', () => {
  logger.warn('⚠️  MongoDB disconnected — attempting reconnect...');
});

mongoose.connection.on('error', (err) => {
  logger.error('❌ MongoDB connection error', { error: err.message });
});

mongoose.connection.on('close', () => {
  logger.info('MongoDB connection closed');
});

// ─── Connect with retry logic ──────────────────────────────────────
async function connectWithRetry(): Promise<void> {
  try {
    await mongoose.connect(MONGO_URI, {
      maxPoolSize: MAX_POOL_SIZE,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
    });
  } catch (err) {
    retryCount++;
    const error = err as Error;

    logger.error(`MongoDB connection attempt ${retryCount}/${MAX_RETRIES} failed`, {
      error: error.message,
    });

    if (retryCount >= MAX_RETRIES) {
      logger.error('💀 Max MongoDB retry attempts reached. Exiting process.');
      process.exit(1);
    }

    logger.info(`Retrying MongoDB connection in ${RETRY_DELAY_MS / 1000}s...`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return connectWithRetry();
  }
}

export async function connectDB(): Promise<void> {
  logger.info('Connecting to MongoDB...');
  await connectWithRetry();
}

export async function disconnectDB(): Promise<void> {
  await mongoose.connection.close();
  logger.info('MongoDB disconnected gracefully');
}

export default mongoose;
