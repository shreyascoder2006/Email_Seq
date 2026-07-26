/**
 * src/services/import.service.ts
 *
 * Core business logic for contact import & field mapping.
 * Handles: file parsing (xlsx), field mapping, validation,
 * duplicate detection, saving to DB, and enrolling into sequences.
 */

import * as XLSX from 'xlsx';
import { Types } from 'mongoose';
import { ImportList, IImportList, ImportListStatus } from '../models/ImportList';
import { ImportedContact, IImportedContact } from '../models/ImportedContact';
import { AppError } from '../utils/AppError';
import { enrollmentService } from './enrollment.service';
import logger from '../config/logger';
import {
  CreateImportListDto,
  EnrollImportListDto,
  FieldMappingItem,
} from '../validators/import.validator';

// ─── Constants ─────────────────────────────────────────────────────

const AUTO_MAP_RULES: Array<{ pattern: RegExp; field: string }> = [
  { pattern: /^e[-_\s]?mail|^email[-_\s]?address|^work[-_\s]?email/i, field: 'email' },
  { pattern: /^first[-_\s]?name|^given[-_\s]?name|^fname|^first$/i, field: 'first_name' },
  { pattern: /^last[-_\s]?name|^surname|^family[-_\s]?name|^lname|^last$/i, field: 'last_name' },
  { pattern: /^full[-_\s]?name|^name|^contact[-_\s]?name/i, field: 'full_name' },
  { pattern: /^company|^org(anization)?|^employer|^business/i, field: 'company' },
  { pattern: /^title|^job[-_\s]?title|^designation|^position|^role/i, field: 'title' },
  { pattern: /^city|^location[-_\s]?city/i, field: 'city' },
  { pattern: /^phone|^phone[-_\s]?number|^mobile/i, field: 'phone' },
];

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Convert a raw column name to a valid snake_case merge-tag key.
 * "First Name" → "first_name", "Pain Point?" → "pain_point"
 */
function toSnakeCase(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, '')  // remove special chars
    .replace(/[\s-]+/g, '_')        // spaces/hyphens → underscore
    .replace(/_+/g, '_')            // collapse multiple underscores
    .replace(/^_|_$/g, '');         // trim leading/trailing underscores
}

/**
 * Given a CSV column name, attempt to auto-map it to a system field.
 * Returns the system field key if matched, null otherwise.
 */
function autoMapColumn(csvColumn: string): string | null {
  for (const rule of AUTO_MAP_RULES) {
    if (rule.pattern.test(csvColumn.trim())) {
      return rule.field;
    }
  }
  return null;
}

/**
 * Generate field mapping suggestions for a list of CSV headers.
 * Unmapped columns become custom variables (snake_cased).
 */
export function generateFieldMappings(headers: string[]): FieldMappingItem[] {
  return headers.map((col) => {
    const systemField = autoMapColumn(col);
    if (systemField) {
      return {
        csv_column:   col,
        system_field: systemField,
        merge_tag:    `{{${systemField}}}`,
        is_system:    true,
      };
    }
    // Custom variable: snake_case the column name
    const customKey = toSnakeCase(col) || `col_${headers.indexOf(col)}`;
    return {
      csv_column:   col,
      system_field: customKey,
      merge_tag:    `{{${customKey}}}`,
      is_system:    false,
    };
  });
}

// ─── Parse helpers ─────────────────────────────────────────────────

/**
 * Parse buffer (CSV or XLSX) → { headers, rows }
 * Only reads the first sheet.
 */
export function parseFileBuffer(buffer: Buffer, mimetype: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw AppError.badRequest('File contains no sheets');

  const worksheet = workbook.Sheets[sheetName];

  // Convert to JSON array: first row = header
  const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(worksheet, {
    defval: '',
    raw: false,
  });

  if (rawRows.length === 0) throw AppError.badRequest('File contains no data rows');

  const headers = Object.keys(rawRows[0]);
  const rows: Record<string, string>[] = rawRows.map((row) => {
    const mapped: Record<string, string> = {};
    for (const h of headers) {
      mapped[h] = String(row[h] ?? '').trim();
    }
    return mapped;
  });

  return { headers, rows };
}

// ─── Service ───────────────────────────────────────────────────────

export interface ParsePreviewResult {
  headers:       string[];
  preview_rows:  Record<string, string>[];  // first 5 rows for display
  all_rows:      Record<string, string>[];  // all rows for saving
  total_rows:    number;
  field_mappings: FieldMappingItem[];
}

export interface ImportSaveResult {
  import_list:     IImportList;
  total:           number;
  valid:           number;
  duplicates:      number;
  errors:          number;
  error_details:   Array<{ row: number; email: string; reason: string }>;
}

export interface EnrollImportResult {
  import_list_id: string;
  sequence_id:    string;
  enrolled:       number;
  skipped:        number;
  failed:         number;
  errors:         Array<{ email: string; reason: string }>;
}

export class ImportService {

  // ── Parse a file for preview (no DB write) ────────────────────────
  parseForPreview(buffer: Buffer, mimetype: string): ParsePreviewResult {
    const { headers, rows } = parseFileBuffer(buffer, mimetype);
    const field_mappings = generateFieldMappings(headers);

    return {
      headers,
      preview_rows:  rows.slice(0, 5),  // first 5 for display only
      all_rows:      rows,               // all rows sent back to client for later save
      total_rows:    rows.length,
      field_mappings,
    };
  }

  // ── Save import list + all contacts to DB ─────────────────────────
  async saveImportList(
    userId: string,
    dto: CreateImportListDto
  ): Promise<ImportSaveResult> {

    // Validate: ensure email field exists in mappings
    const emailMapping = dto.field_mappings.find((m) => m.system_field === 'email');
    if (!emailMapping) {
      throw AppError.badRequest(
        'Field mapping must include an "email" column. Please map one CSV column to "email".'
      );
    }
    const emailColumn = emailMapping.csv_column;

    // ── Duplicate detection (within this file) ─────────────────────
    const seenEmails = new Set<string>();
    const duplicateEmails = new Set<string>();
    for (const row of dto.rows) {
      const email = (row[emailColumn] ?? '').trim().toLowerCase();
      if (!email) continue;
      if (seenEmails.has(email)) {
        duplicateEmails.add(email);
      } else {
        seenEmails.add(email);
      }
    }

    // ── Process each row ───────────────────────────────────────────
    const contactDocs: Array<Omit<IImportedContact, '_id' | 'created_at' | 'updated_at' | keyof import('mongoose').Document>> = [];
    const errorDetails: Array<{ row: number; email: string; reason: string }> = [];
    let validCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;

    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      const rowNumber = i + 1;
      const errors: string[] = [];

      // Map row → structured data
      const email      = (row[emailColumn] ?? '').trim().toLowerCase();
      let   first_name = '';
      let   last_name  = '';
      let   company    = '';
      const custom_variables: Record<string, string> = {};

      for (const mapping of dto.field_mappings) {
        const rawVal = (row[mapping.csv_column] ?? '').trim();
        if (mapping.system_field === 'email') continue; // handled above
        if (mapping.system_field === 'first_name') { first_name = rawVal; continue; }
        if (mapping.system_field === 'last_name')  { last_name  = rawVal; continue; }
        if (mapping.system_field === 'company')    { company    = rawVal; continue; }
        // Everything else → custom_variables
        if (rawVal) custom_variables[mapping.system_field] = rawVal;
      }

      // Validate email
      if (!email) {
        errors.push('Email is required');
        errorCount++;
        errorDetails.push({ row: rowNumber, email: '', reason: 'Email is required' });
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push(`Invalid email: ${email}`);
        errorCount++;
        errorDetails.push({ row: rowNumber, email, reason: `Invalid email format` });
      }

      const isDuplicate = email ? duplicateEmails.has(email) : false;
      if (isDuplicate) duplicateCount++;
      if (errors.length === 0) validCount++;

      // Build row_data map from raw row
      const row_data = new Map<string, string>(Object.entries(row));

      contactDocs.push({
        user_id:        new Types.ObjectId(userId) as any,
        import_list_id: new Types.ObjectId() as any, // will be overwritten below
        row_data,
        mapped_data: {
          email:      email || '',
          first_name: first_name || undefined,
          last_name:  last_name  || undefined,
          company:    company    || undefined,
          custom_variables,
        },
        row_number:        rowNumber,
        is_duplicate:      isDuplicate,
        validation_errors: errors,
      } as any);
    }

    // ── Create ImportList document ──────────────────────────────────
    const importList = await ImportList.create({
      user_id:          new Types.ObjectId(userId),
      name:             dto.name,
      filename:         dto.filename,
      original_headers: dto.original_headers,
      field_mappings:   dto.field_mappings,
      row_count:        dto.rows.length,
      valid_count:      validCount,
      duplicate_count:  duplicateCount,
      error_count:      errorCount,
      status:           ImportListStatus.IMPORTED,
    });

    // Stamp import_list_id on every contact doc
    const listId = importList._id as Types.ObjectId;
    const docsToInsert = contactDocs.map((d: any) => ({ ...d, import_list_id: listId }));

    // ── Bulk insert contacts ────────────────────────────────────────
    if (docsToInsert.length > 0) {
      await ImportedContact.insertMany(docsToInsert, { ordered: false });
    }

    logger.info('Import list saved', {
      userId,
      importListId: importList._id,
      total:        dto.rows.length,
      valid:        validCount,
      duplicates:   duplicateCount,
      errors:       errorCount,
    });

    return {
      import_list:   importList,
      total:         dto.rows.length,
      valid:         validCount,
      duplicates:    duplicateCount,
      errors:        errorCount,
      error_details: errorDetails,
    };
  }

  // ── List import lists for a user ──────────────────────────────────
  async listImportLists(userId: string): Promise<IImportList[]> {
    return ImportList.find({ user_id: userId })
      .sort({ created_at: -1 })
      .lean<IImportList[]>();
  }

  // ── Get single import list + first 100 contacts ───────────────────
  async getImportList(userId: string, listId: string): Promise<{
    import_list: IImportList;
    contacts:    IImportedContact[];
    total:       number;
  }> {
    const importList = await ImportList.findOne({
      _id:     listId,
      user_id: userId,
    }).lean<IImportList>();
    if (!importList) throw AppError.notFound('Import list');

    const [contacts, total] = await Promise.all([
      ImportedContact.find({ import_list_id: listId })
        .sort({ row_number: 1 })
        .limit(100)
        .lean<IImportedContact[]>(),
      ImportedContact.countDocuments({ import_list_id: listId }),
    ]);

    return { import_list: importList, contacts, total };
  }

  // ── Delete import list + its contacts ────────────────────────────
  async deleteImportList(userId: string, listId: string): Promise<void> {
    const importList = await ImportList.findOne({ _id: listId, user_id: userId });
    if (!importList) throw AppError.notFound('Import list');

    await Promise.all([
      ImportList.deleteOne({ _id: listId }),
      ImportedContact.deleteMany({ import_list_id: listId }),
    ]);

    logger.info('Import list deleted', { userId, listId });
  }

  // ── Update import list settings ──────────────────────────────────────
  async updateSettings(
    userId: string,
    listId: string,
    dto: { name?: string; description?: string }
  ): Promise<IImportList> {
    const importList = await ImportList.findOne({ _id: listId, user_id: userId });
    if (!importList) throw AppError.notFound('Import list');

    if (dto.name !== undefined) importList.name = dto.name;
    if (dto.description !== undefined) importList.description = dto.description;

    await importList.save();
    logger.info('Import list settings updated', { userId, listId });

    return importList;
  }

  // ── Clone an existing import list and its contacts ────────────────────
  async cloneList(userId: string, listId: string): Promise<{ new_list_id: string; copied_count: number }> {
    const originalList = await ImportList.findOne({ _id: listId, user_id: userId }).lean<IImportList>();
    if (!originalList) throw AppError.notFound('Import list');

    // Naming strategy: "Original Name (Copy X)"
    let newName = `${originalList.name} (Copy)`;
    const match = originalList.name.match(/^(.*?)\s*\(Copy(?: (\d+))?\)$/);
    if (match) {
      const base = match[1];
      const num = match[2] ? parseInt(match[2], 10) + 1 : 2;
      newName = `${base} (Copy ${num})`;
    }

    const newList = await ImportList.create({
      user_id: originalList.user_id,
      name: newName,
      description: originalList.description,
      filename: originalList.filename,
      original_headers: originalList.original_headers,
      field_mappings: originalList.field_mappings,
      row_count: originalList.row_count,
      valid_count: originalList.valid_count,
      duplicate_count: originalList.duplicate_count,
      error_count: originalList.error_count,
      status: originalList.status,
    });

    const newListId = newList._id as Types.ObjectId;

    // Batch copy contacts
    const cursor = ImportedContact.find({ import_list_id: listId }).lean().cursor();
    let batch: any[] = [];
    let copiedCount = 0;
    const BATCH_SIZE = 1000;

    for await (const doc of cursor) {
      delete (doc as any)._id;
      delete (doc as any).created_at;
      delete (doc as any).updated_at;
      doc.import_list_id = newListId as any;
      batch.push(doc);

      if (batch.length >= BATCH_SIZE) {
        await ImportedContact.insertMany(batch, { ordered: false });
        copiedCount += batch.length;
        batch = [];
      }
    }

    if (batch.length > 0) {
      await ImportedContact.insertMany(batch, { ordered: false });
      copiedCount += batch.length;
    }

    logger.info('Import list cloned', { userId, oldListId: listId, newListId, copiedCount });

    return {
      new_list_id: newListId.toString(),
      copied_count: copiedCount,
    };
  }

  // ── Enroll entire import list into a sequence ─────────────────────
  async enrollList(
    userId:     string,
    listId:     string,
    sequenceId: string,
    dto:        EnrollImportListDto
  ): Promise<EnrollImportResult> {
    // Verify list ownership
    const importList = await ImportList.findOne({ _id: listId, user_id: userId });
    if (!importList) throw AppError.notFound('Import list');

    // Load all valid (non-error) contacts
    const contacts = await ImportedContact.find({
      import_list_id:    listId,
      validation_errors: { $size: 0 },
    }).lean<IImportedContact[]>();

    if (contacts.length === 0) {
      throw AppError.badRequest('Import list has no valid contacts to enroll');
    }

    // Build enrollment payload
    const enrollPayload = contacts.map((c) => ({
      email:            c.mapped_data.email,
      first_name:       c.mapped_data.first_name || '',
      last_name:        c.mapped_data.last_name,
      company:          c.mapped_data.company,
      custom_variables: c.mapped_data.custom_variables ?? {},
    }));

    // Use existing enrollment service (skip_existing = true per user spec)
    const result = await enrollmentService.enroll(userId, sequenceId, {
      contacts:      enrollPayload,
      start_at:      dto.start_at,
      skip_existing: true,
    });

    logger.info('Import list enrolled into sequence', {
      userId,
      listId,
      sequenceId,
      enrolled: result.enrolled,
      skipped:  result.skipped,
      failed:   result.failed,
    });

    return {
      import_list_id: listId,
      sequence_id:    sequenceId,
      enrolled:       result.enrolled,
      skipped:        result.skipped,
      failed:         result.failed,
      errors:         result.errors,
    };
  }
}

export const importService = new ImportService();
