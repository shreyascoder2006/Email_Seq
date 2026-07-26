import { GenerateEmailRequest } from '../../validators/ai.validator';
import { ALL_STANDARD_TAGS } from '../../utils/mergeTags.registry';

export class PromptBuilder {
  /**
   * Constructs a pure, provider-neutral prompt for the LLM based on the validated request.
   */
  public build(request: GenerateEmailRequest): string {
    const {
      objective,
      length,
      offering,
      audience,
      painPoint,
      cta,
      guidance
    } = request;

    let lengthInstruction = '';
    switch (length) {
      case 'short':
        lengthInstruction = 'short (roughly 50-90 words)';
        break;
      case 'medium':
        lengthInstruction = 'medium (roughly 90-150 words)';
        break;
      case 'long':
        lengthInstruction = 'long (roughly 150-220 words)';
        break;
      default:
        lengthInstruction = 'medium (roughly 90-150 words)';
    }

    const allowedMergeTags = ALL_STANDARD_TAGS.map(t => t.tag);

    let prompt = `You are an expert B2B copywriter writing a professional outbound email template.
Your goal is to write a highly converting, natural-sounding email.

### CAMPAIGN CONTEXT
- **Objective**: ${objective}
- **Target Audience**: ${audience}
- **What We Offer**: ${offering}
`;

    if (painPoint) {
      prompt += `- **Pain Point to Address**: ${painPoint}\n`;
    }

    if (cta) {
      prompt += `- **Call to Action**: ${cta}\n`;
    }

    prompt += `
### EMAIL QUALITY RULES
1. Provide a concise, professional subject line.
2. Write natural, conversational email copy.
3. DO NOT use fake statistics, fake customer names, or fabricated claims.
4. DO NOT use markdown code fences in your output.
5. DO NOT provide any explanations outside the requested response structure.
6. DO NOT include "Subject:" inside the bodyHtml.
7. Avoid excessive marketing language, spammy ALL CAPS, and unnecessary emojis.
8. Length guidance: The email body should be ${lengthInstruction}.
`;

    if (guidance) {
      prompt += `\n### ADDITIONAL INSTRUCTIONS\n${guidance}\n`;
    }

    prompt += `
### MERGE TAGS
You may use the following merge tags to personalize the email. 
DO NOT invent any other merge tags (e.g., do not use {{job_role}}, [First Name], etc.).
Allowed Tags:
${allowedMergeTags.join(', ')}

Note: Return ONLY the structured JSON containing "subject" and "bodyHtml". The bodyHtml should use basic HTML tags for formatting (e.g., <p>, <br>).
`;

    return prompt;
  }
}
