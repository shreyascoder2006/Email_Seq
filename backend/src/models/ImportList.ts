import { Schema, model, Document, Types } from 'mongoose';

// ─── Enums ─────────────────────────────────────────────────────────
export enum ImportListStatus {
  PENDING  = 'pending',   // uploaded, not yet mapped
  MAPPED   = 'mapped',    // field mapping configured
  IMPORTED = 'imported',  // contacts saved to imported_contacts
}

// ─── Interfaces ────────────────────────────────────────────────────

/** A single column-to-field mapping entry */
export interface FieldMapping {
  csv_column:   string;  // original CSV header, e.g. "First Name"
  system_field: string;  // mapped key, e.g. "first_name" or custom "pain_point"
  merge_tag:    string;  // auto-generated, e.g. "{{first_name}}"
  is_system:    boolean; // true = built-in field (email/first_name/etc), false = custom_variables
}

export interface IImportList extends Document {
  user_id:          Types.ObjectId;
  name:             string;           // user-visible name, default = filename
  description:      string;           // user-provided description
  filename:         string;           // original file name
  original_headers: string[];         // raw CSV headers in order
  field_mappings:   FieldMapping[];   // column → system field mappings
  row_count:        number;           // total rows (excl. header)
  valid_count:      number;           // rows with valid email
  duplicate_count:  number;           // rows with duplicate email (within file)
  error_count:      number;           // rows with validation errors
  status:           ImportListStatus;
  created_at:       Date;
  updated_at:       Date;
}

// ─── Sub-schema ────────────────────────────────────────────────────
const FieldMappingSchema = new Schema<FieldMapping>(
  {
    csv_column:   { type: String, required: true },
    system_field: { type: String, required: true },
    merge_tag:    { type: String, required: true },
    is_system:    { type: Boolean, default: false },
  },
  { _id: false }
);

// ─── Schema ────────────────────────────────────────────────────────
const ImportListSchema = new Schema<IImportList>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name:             { type: String, required: true, trim: true, maxlength: 200 },
    description:      { type: String, default: '', trim: true, maxlength: 500 },
    filename:         { type: String, required: true, trim: true },
    original_headers: { type: [String], default: [] },
    field_mappings:   { type: [FieldMappingSchema], default: [] },
    row_count:        { type: Number, default: 0, min: 0 },
    valid_count:      { type: Number, default: 0, min: 0 },
    duplicate_count:  { type: Number, default: 0, min: 0 },
    error_count:      { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: Object.values(ImportListStatus),
      default: ImportListStatus.PENDING,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'import_lists',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────
ImportListSchema.index({ user_id: 1, created_at: -1 });

// ─── Model ────────────────────────────────────────────────────────
export const ImportList = model<IImportList>('ImportList', ImportListSchema);
