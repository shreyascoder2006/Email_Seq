import { z } from 'zod';

// ─── Shared ────────────────────────────────────────────────────────
const objectIdField = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Must be a valid MongoDB ObjectId');

// ─── Field mapping entry ───────────────────────────────────────────
const FieldMappingSchema = z.object({
  csv_column:   z.string().min(1, 'csv_column is required'),
  system_field: z.string().min(1, 'system_field is required'),
  merge_tag:    z.string().min(1, 'merge_tag is required'),
  is_system:    z.boolean().default(false),
});

// ─── POST /api/imports  (save with mapping) ────────────────────────
export const CreateImportListSchema = z.object({
  name: z.string().trim().min(1).max(200),

  filename: z.string().trim().min(1),

  original_headers: z.array(z.string()).min(1, 'At least one header required'),

  field_mappings: z
    .array(FieldMappingSchema)
    .min(1, 'At least one field mapping required'),

  /**
   * Full row data sent from client preview.
   * Each row is a map of csv_column → raw value.
   */
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1, 'At least one data row required'),
});

// ─── POST /api/imports/:id/enroll/:sequenceId ──────────────────────
export const EnrollImportListSchema = z.object({
  start_at: z
    .string()
    .datetime({ message: 'start_at must be an ISO 8601 datetime' })
    .optional(),
});

// ─── PATCH /api/imports/:id/settings ───────────────────────────────
export const UpdateImportSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'Name max 200 chars').optional(),
  description: z.string().trim().max(500, 'Description max 500 chars').optional(),
});

// ─── Params ────────────────────────────────────────────────────────
export const ImportIdParamSchema = z.object({
  id: objectIdField,
});

export const ImportEnrollParamSchema = z.object({
  id:         objectIdField,
  sequenceId: objectIdField,
});

// ─── Inferred types ────────────────────────────────────────────────
export type CreateImportListDto  = z.infer<typeof CreateImportListSchema>;
export type EnrollImportListDto  = z.infer<typeof EnrollImportListSchema>;
export type UpdateImportSettingsDto = z.infer<typeof UpdateImportSettingsSchema>;
export type FieldMappingItem     = z.infer<typeof FieldMappingSchema>;
