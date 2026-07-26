import { PromptBuilder } from '../services/ai/prompt.builder';
import { GenerateEmailRequest } from '../validators/ai.validator';
import logger from '../config/logger';

function runPromptBuilderTest() {
  logger.info('Starting PromptBuilder isolated test...');

  const builder = new PromptBuilder();
  
  const req: GenerateEmailRequest = {
    objective: "Book a product demo",
    length: "short",
    offering: "An email sequencing platform that helps sales teams automate personalized outreach",
    audience: "Sales managers at B2B SaaS companies",
    painPoint: "Manually following up with leads takes too much time",
    cta: "Ask if they are open to a 15-minute demo",
    guidance: "Professional, conversational and not overly salesy"
  };

  const prompt = builder.build(req);

  logger.info('Generated Prompt:');
  logger.info('\n' + prompt);

  let passed = true;

  const checks = [
    { label: 'objective appears', str: req.objective },
    { label: 'offering appears', str: req.offering },
    { label: 'audience appears', str: req.audience },
    { label: 'painPoint appears', str: req.painPoint! },
    { label: 'cta appears', str: req.cta! },
    { label: 'guidance appears', str: req.guidance! },
    { label: 'length guidance appears', str: 'short (roughly 50-90 words)' },
    { label: 'merge-tag instructions appear', str: '{{first_name}}' }
  ];

  for (const check of checks) {
    if (prompt.includes(check.str)) {
      logger.info(`✅ ${check.label}`);
    } else {
      logger.error(`❌ ${check.label} FAILED`);
      passed = false;
    }
  }

  if (passed) {
    logger.info('🎉 PromptBuilder test PASSED');
    process.exit(0);
  } else {
    logger.error('💥 PromptBuilder test FAILED');
    process.exit(1);
  }
}

runPromptBuilderTest();
