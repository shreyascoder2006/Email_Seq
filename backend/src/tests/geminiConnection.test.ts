import '../config/env'; // Load env variables first
import { GeminiProvider } from '../services/ai/providers/gemini.provider';
import logger from '../config/logger';

async function runConnectivityTest() {
  logger.info('Starting isolated Gemini connectivity test...');

  try {
    const provider = new GeminiProvider();
    
    logger.info('Provider instantiated successfully. Sending test prompt...');
    
    const prompt = 'Reply with exactly: GEMINI_CONNECTION_OK';
    const response = await provider.generateText(prompt);
    
    logger.info('✅ Response received from Gemini:');
    logger.info(`"${response.trim()}"`);
    
    if (response.trim() === 'GEMINI_CONNECTION_OK') {
      logger.info('✅ Connectivity test PASSED.');
    } else {
      logger.warn('⚠️ Response did not perfectly match expected output, but connection succeeded.');
    }

    process.exit(0);
  } catch (err: any) {
    logger.error('❌ Connectivity test FAILED.', {
      error: err.message
    });
    process.exit(1);
  }
}

runConnectivityTest();
