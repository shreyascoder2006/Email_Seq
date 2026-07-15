import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAuditLog extends Document {
  user_id: Types.ObjectId;
  sequence_id: Types.ObjectId;
  action_type: string;
  timestamp: Date;
  browser_timezone: string;
  affected_contacts_count: number;
  details: any;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sequence_id: { type: Schema.Types.ObjectId, ref: 'Sequence', required: true },
    action_type: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    browser_timezone: { type: String, required: true },
    affected_contacts_count: { type: Number, required: true },
    details: { type: Schema.Types.Mixed }, // flexible JSON for previous/new next_send_at, etc.
  },
  { timestamps: true }
);

// Indexes
AuditLogSchema.index({ sequence_id: 1, timestamp: -1 });
AuditLogSchema.index({ user_id: 1, action_type: 1 });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
