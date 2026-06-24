import { Schema, model, Document, Types } from 'mongoose';

// ─── Interfaces ────────────────────────────────────────────────────

/** The structured data extracted + mapped from a single CSV row */
export interface MappedContactData {
  email:       string;
  first_name?: string;
  last_name?:  string;
  company?:    string;
  /** All unmapped columns + any extra fields (key = snake_case column name) */
  custom_variables: Record<string, string>;
}

export interface IImportedContact extends Document {
  user_id:        Types.ObjectId;
  import_list_id: Types.ObjectId;

  /** Raw row data (original CSV column → raw value) */
  row_data: Map<string, string>;

  /** Structured, mapped data ready for enrollment */
  mapped_data: MappedContactData;

  /** Row number in the original file (1-based, excluding header) */
  row_number: number;

  /** True if this email appears more than once in the same import */
  is_duplicate: boolean;

  /** Validation errors for this row, e.g. ["email is required"] */
  validation_errors: string[];

  created_at: Date;
  updated_at: Date;
}

// ─── Sub-schema ────────────────────────────────────────────────────
const MappedContactDataSchema = new Schema<MappedContactData>(
  {
    email:      { type: String, required: true, trim: true, lowercase: true },
    first_name: { type: String, trim: true },
    last_name:  { type: String, trim: true },
    company:    { type: String, trim: true },
    custom_variables: {
      type: Map,
      of: String,
      default: {},
    },
  },
  { _id: false }
);

// ─── Schema ────────────────────────────────────────────────────────
const ImportedContactSchema = new Schema<IImportedContact>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    import_list_id: {
      type: Schema.Types.ObjectId,
      ref: 'ImportList',
      required: true,
    },

    row_data: {
      type: Map,
      of: String,
      default: {},
    },

    mapped_data: { type: MappedContactDataSchema, required: true },

    row_number: { type: Number, required: true },

    is_duplicate:      { type: Boolean, default: false },
    validation_errors: { type: [String], default: [] },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'imported_contacts',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────
ImportedContactSchema.index({ import_list_id: 1, row_number: 1 });
ImportedContactSchema.index({ import_list_id: 1, is_duplicate: 1 });
ImportedContactSchema.index({ user_id: 1, import_list_id: 1 });

// ─── Model ────────────────────────────────────────────────────────
export const ImportedContact = model<IImportedContact>(
  'ImportedContact',
  ImportedContactSchema
);
