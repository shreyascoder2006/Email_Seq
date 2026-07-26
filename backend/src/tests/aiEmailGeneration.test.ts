import '../config/env'; // Load env variables first
import { AIEmailService } from '../services/ai/ai.service';
import { GenerateEmailRequest } from '../validators/ai.validator';
import logger from '../config/logger';

async function runAIEmailGenerationTest() {
  logger.info('Starting AIEmailService isolated generation test...');

  try {
    const service = new AIEmailService();
    
    const req: GenerateEmailRequest = {
      objective: "Book a product demo",
      length: "short",
      offering: "An email sequencing platform that helps sales teams automate personalized outreach",
      audience: "Sales managers at B2B SaaS companies",
      painPoint: "Manually following up with leads takes too much time",
      cta: "Ask if they are open to a 15-minute demo",
      guidance: "Professional, conversational and not overly salesy"
    };

    logger.info('Sending REAL Gemini request (this may take a few seconds)...');
    
    const response = await service.generateEmail(req);
    
    logger.info('✅ Response received successfully!');
    logger.info('\n==================================================');
    logger.info(`SUBJECT: \n${response.subject}`);
    logger.info('\nBODY: \n' + response.bodyHtml);
    logger.info('==================================================\n');
    
    // Validation
    if (!response.subject || !response.bodyHtml) {
      logger.error('❌ Validation Failed: subject or bodyHtml is empty');
      process.exit(1);
    }
    
    logger.info('✅ Generation test PASSED (Structured JSON + Validation successful).');
    process.exit(0);

  } catch (err: any) {
    logger.error('❌ Generation test FAILED.', {
      error: err.message
    });
    process.exit(1);
  }
}

runAIEmailGenerationTest();
