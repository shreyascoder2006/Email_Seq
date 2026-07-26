import { ALL_STANDARD_TAG_NAMES } from '../utils/mergeTags.registry';

export interface MergeTagValidationResult {
  valid: boolean;
  usedTags: string[];
  unknownTags: string[];
}

/**
 * Scans the provided text for Handlebars-style merge tags and ensures
 * all extracted tags exist in the canonical ALL_STANDARD_TAG_NAMES registry.
 * 
 * Supports fallback syntax natively (e.g., {{first_name|there}} extracts "first_name").
 */
export function validateMergeTags(subject: string, bodyHtml: string): MergeTagValidationResult {
  const text = `${subject} \n ${bodyHtml}`;
  
  // This regex matches exactly the application's existing renderer behavior.
  // It handles:
  // - {{first_name}}
  // - {{ first_name }}
  // - {{first_name|there}}
  // Extracting Group 1 as the tag name.
  const regex = /{{\s*([a-zA-Z0-9_]+)(?:\|([^}]+))?\s*}}/g;
  
  const usedTags = new Set<string>();
  const unknownTags = new Set<string>();
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    const tagName = match[1].toLowerCase();
    usedTags.add(tagName);
    
    if (!ALL_STANDARD_TAG_NAMES.includes(tagName)) {
      unknownTags.add(tagName);
    }
  }

  return {
    valid: unknownTags.size === 0,
    usedTags: Array.from(usedTags),
    unknownTags: Array.from(unknownTags)
  };
}
