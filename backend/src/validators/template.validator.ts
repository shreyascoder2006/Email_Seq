import { z } from 'zod';
import { TemplateCategory } from '../models/Template';

export const CreateTemplateSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200),
  subject: z.string().trim().min(1, 'Subject is required').max(500),
  body_html: z.string().trim().min(1, 'HTML body is required'),
  category: z.nativeEnum(TemplateCategory).optional(),
});

export const UpdateTemplateSchema = CreateTemplateSchema.partial();

export const IdParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid MongoDB ObjectId'),
});

export const PreviewTemplateSchema = z.object({
  contact: z.record(z.string()).optional(),
});

export type CreateTemplateDto = z.infer<typeof CreateTemplateSchema>;
export type UpdateTemplateDto = z.infer<typeof UpdateTemplateSchema>;
