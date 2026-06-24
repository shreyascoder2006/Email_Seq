import { Schema, model, Document, Types } from 'mongoose';

export interface ICustomField extends Document {
  user_id: Types.ObjectId;
  key: string;       // e.g. "favorite_product"
  label: string;     // e.g. "Favorite Product"
  created_at: Date;
}

const CustomFieldSchema = new Schema<ICustomField>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    key: { 
      type: String, 
      required: true, 
      trim: true, 
      lowercase: true,
      // only allow alphanumeric and underscores
      match: /^[a-z0-9_]+$/
    },
    label: { type: String, required: true, trim: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    collection: 'custom_fields',
  }
);

// A user can't have duplicate custom field keys
CustomFieldSchema.index({ user_id: 1, key: 1 }, { unique: true });

export const CustomField = model<ICustomField>('CustomField', CustomFieldSchema);
