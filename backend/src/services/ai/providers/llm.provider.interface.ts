export interface LLMProvider {
  /**
   * Generates text based on a given prompt.
   * Minimal interface for Phase 3 connectivity test.
   */
  generateText(prompt: string): Promise<string>;
}
