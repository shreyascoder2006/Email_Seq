import { GenerateEmailRequest, GenerateEmailResponse, GenerateEmailResponseSchema } from '../../validators/ai.validator';
import { validateMergeTags } from '../../validators/mergeTag.validator';
import { PromptBuilder } from './prompt.builder';
import { GeminiProvider } from './providers/gemini.provider';
import { LLMProvider } from './providers/llm.provider.interface';
import { AppError } from '../../utils/AppError';
import logger from '../../config/logger';

export class AIEmailService {
  private promptBuilder: PromptBuilder;
  private llmProvider: LLMProvider;

  constructor() {
    this.promptBuilder = new PromptBuilder();
    // Defaulting to GeminiProvider for now.
    this.llmProvider = new GeminiProvider();
  }

  /**
   * Generates a professional email template from the AI provider.
   * Handles validation and structured parsing safely.
   */
  public async generateEmail(request: GenerateEmailRequest): Promise<GenerateEmailResponse> {
    try {
      // 1. Build prompt
      const prompt = this.promptBuilder.build(request);

      // 2. Call provider (returns structured JSON string)
      const responseText = await this.llmProvider.generateText(prompt);

      // 3. Parse JSON
      let parsedData: unknown;
      try {
        parsedData = JSON.parse(responseText);
      } catch (err: any) {
        logger.error('Failed to parse AI provider JSON response', {
          response: responseText,
          error: err.message
        });
        throw new AppError('AI provider returned malformed JSON structure', 502);
      }

      // 4. Validate output schema using Zod
      const validationResult = GenerateEmailResponseSchema.safeParse(parsedData);
      
      if (!validationResult.success) {
        logger.error('AI provider response failed validation schema', {
          issues: validationResult.error.issues,
          parsedData
        });
        throw new AppError('AI provider returned invalid structured data', 502);
      }

      // 5. Validate merge tags
      const { subject, bodyHtml } = validationResult.data;
      const tagValidation = validateMergeTags(subject, bodyHtml);
      
      if (!tagValidation.valid) {
        logger.error('AI provider generated unsupported merge tags', {
          unknownTags: tagValidation.unknownTags
        });
        throw new AppError(`AI generated unsupported merge tags: ${tagValidation.unknownTags.join(', ')}`, 502);
      }

      return validationResult.data;

    } catch (err: any) {
      // Ensure we always throw AppError
      if (err instanceof AppError) {
        throw err;
      }
      logger.error('AIEmailService generation error', { error: err.message });
      throw new AppError('An unexpected error occurred during AI email generation', 500);
    }
  }
}
