import { validateMergeTags } from '../validators/mergeTag.validator';
import { AIEmailService } from '../services/ai/ai.service';
import logger from '../config/logger';

async function runMergeTagValidatorTest() {
  logger.info('Starting deterministic MergeTagValidator tests...');
  
  let passed = true;

  const testCases = [
    { name: '1. No merge tags', subject: 'Hello', body: 'World', expectValid: true },
    { name: '2. {{first_name}}', subject: 'Hello', body: 'World {{first_name}}', expectValid: true },
    { name: '3. {{company}} in subject', subject: 'Hello {{company}}', body: 'World', expectValid: true },
    { name: '4. Multiple supported tags', subject: 'Hello {{company}}', body: 'World {{first_name}}', expectValid: true },
    { name: '5. Duplicate supported tag', subject: 'Hello {{company}}', body: 'World {{company}}', expectValid: true },
    { name: '6. {{unknown_tag}}', subject: 'Hello', body: 'World {{unknown_tag}}', expectValid: false, expectUnknown: 'unknown_tag' },
    { name: '7. Unknown tag in subject', subject: 'Hello {{unknown_tag}}', body: 'World', expectValid: false, expectUnknown: 'unknown_tag' },
    { name: '8. Unknown tag in bodyHtml', subject: 'Hello', body: 'World {{fake_tag}}', expectValid: false, expectUnknown: 'fake_tag' },
    { name: '9. Whitespace {{ first_name }}', subject: 'Hello', body: 'World {{ first_name }}', expectValid: true },
    { name: '10. Fallback syntax {{first_name|there}}', subject: 'Hello', body: 'World {{first_name|there}}', expectValid: true },
    { name: '11. Mixed {{first_name}} + {{fake_company}}', subject: 'Hello', body: 'World {{first_name}} and {{fake_company}}', expectValid: false, expectUnknown: 'fake_company' },
  ];

  for (const tc of testCases) {
    const res = validateMergeTags(tc.subject, tc.body);
    if (res.valid === tc.expectValid) {
      if (!tc.expectValid && tc.expectUnknown && !res.unknownTags.includes(tc.expectUnknown)) {
        logger.error(`❌ ${tc.name} FAILED: Did not find expected unknown tag ${tc.expectUnknown}. Found: ${res.unknownTags}`);
        passed = false;
      } else {
        logger.info(`✅ ${tc.name}`);
      }
    } else {
      logger.error(`❌ ${tc.name} FAILED: expected valid=${tc.expectValid} but got valid=${res.valid}. Unknown tags: ${res.unknownTags}`);
      passed = false;
    }
  }

  // 12. AIEmailService rejects provider output containing unsupported tags.
  logger.info('Running AIEmailService rejection test with mocked LLMProvider...');
  const service = new AIEmailService();
  
  // Mocking the provider
  (service as any).llmProvider = {
    generateText: async () => JSON.stringify({ subject: 'Hello', bodyHtml: 'World {{fake_tag}}' })
  };

  try {
    await service.generateEmail({ objective: 'Test', length: 'short', offering: 'Test', audience: 'Test' });
    logger.error('❌ 12. AIEmailService test FAILED: Expected an error to be thrown');
    passed = false;
  } catch (err: any) {
    if (err.message.includes('AI generated unsupported merge tags: fake_tag')) {
      logger.info('✅ 12. AIEmailService correctly rejected unknown tag');
    } else {
      logger.error(`❌ 12. AIEmailService test FAILED: Unexpected error message: ${err.message}`);
      passed = false;
    }
  }

  if (passed) {
    logger.info('🎉 All MergeTagValidator tests PASSED');
    process.exit(0);
  } else {
    logger.error('💥 MergeTagValidator tests FAILED');
    process.exit(1);
  }
}

runMergeTagValidatorTest();
