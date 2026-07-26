import { GoogleGenAI, Type } from '@google/genai';
import { env } from '../../../config/env';
import { LLMProvider } from './llm.provider.interface';
import { AppError } from '../../../utils/AppError';
import logger from '../../../config/logger';

export class GeminiProvider implements LLMProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor() {
    if (!env.GEMINI_API_KEY) {
      throw new AppError('Gemini API key is not configured in the environment', 500);
    }
    // Initialize the modern @google/genai SDK
    this.ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    this.model = env.GEMINI_MODEL;
  }

  public async generateText(prompt: string): Promise<string> {
    try {
      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING },
          bodyHtml: { type: Type.STRING },
        },
        required: ["subject", "bodyHtml"],
      };

      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        }
      });

      if (!response.text) {
        throw new Error('No text returned from Gemini API');
      }

      return response.text;
    } catch (err: any) {
      logger.error('Gemini API Error', {
        error: err.message,
        stack: err.stack,
      });

      // Distinguish specific provider failures safely
      if (err.message?.includes('API key not valid') || err.status === 403) {
        throw new AppError('Authentication/API key failure with Gemini API', 500);
      }
      if (err.status === 429) {
        throw new AppError('Rate limit exceeded for Gemini API', 429);
      }
      if (err.status === 503 || err.status === 504) {
        throw new AppError('Gemini API is currently unavailable or timed out', 502);
      }
      
      throw new AppError(`Provider error: ${err.message || 'Unknown error'}`, 502);
    }
  }
}
