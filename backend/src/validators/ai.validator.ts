import { z } from 'zod';

export const GenerateEmailSchema = z.object({
  objective: z.string().min(1, 'Objective is required').max(200),
  length: z.enum(['short', 'medium', 'long']),
  offering: z.string().min(1, 'Offering is required').max(500),
  audience: z.string().min(1, 'Audience is required').max(200),
  painPoint: z.string().max(500).optional(),
  cta: z.string().max(200).optional(),
  guidance: z.string().max(1000).optional()
});

export type GenerateEmailRequest = z.infer<typeof GenerateEmailSchema>;

export const GenerateEmailResponseSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(200),
  bodyHtml: z.string().min(1, 'Body HTML is required').max(10000)
});

export type GenerateEmailResponse = z.infer<typeof GenerateEmailResponseSchema>;
