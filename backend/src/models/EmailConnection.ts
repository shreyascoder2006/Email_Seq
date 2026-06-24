import { Schema, model, Document, Types } from 'mongoose';

// ─── Enums ─────────────────────────────────────────────────────────
export enum SmtpEncryption {
  TLS  = 'tls',
  SSL  = 'ssl',
  NONE = 'none',
}

export enum ConnectionStatus {
  ACTIVE   = 'active',
  INACTIVE = 'inactive',
  FAILED   = 'failed',
  PENDING  = 'pending', // awaiting first verification
}

export enum ProviderType {
  GMAIL    = 'gmail',
  OUTLOOK  = 'outlook',
  YAHOO    = 'yahoo',
  SENDGRID = 'sendgrid',
  MAILGUN  = 'mailgun',
  CUSTOM   = 'custom',
}

// ─── TypeScript Interface ──────────────────────────────────────────
export interface IEmailConnection extends Document {
  user_id: Types.ObjectId;

  // Display
  label: string;              // "My Gmail Account"
  from_name: string;          // "John Doe"
  from_email: string;         // "john@gmail.com"
  reply_to?: string;

  // Provider
  provider: ProviderType;

  // Auth Method
  auth_method: 'smtp' | 'oauth2';
  oauth_refresh_token_enc?: string;

  // SMTP
  smtp_host: string;
  smtp_port: number;
  smtp_encryption: SmtpEncryption;
  smtp_username?: string;
  smtp_password_enc?: string;  // AES-256-CBC encrypted

  // IMAP (optional — for reply detection)
  imap_host?: string;
  imap_port?: number;
  imap_encryption?: SmtpEncryption;
  imap_username?: string;
  imap_password_enc?: string; // AES-256-CBC encrypted

  // Sending limits
  daily_limit: number;        // max emails/day
  hourly_limit: number;       // max emails/hour
  min_interval_seconds: number; // min gap between sends

  // Stats (denormalized for fast dashboard queries)
  total_sent: number;
  total_bounced: number;
  last_used_at?: Date;
  last_verified_at?: Date;
  last_imap_poll_at?: Date;

  // Status
  status: ConnectionStatus;
  failure_reason?: string;

  // Timestamps
  created_at: Date;
  updated_at: Date;
}

// ─── Schema ────────────────────────────────────────────────────────
const EmailConnectionSchema = new Schema<IEmailConnection>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    label:       { type: String, required: true, trim: true, maxlength: 100 },
    from_name:   { type: String, required: true, trim: true, maxlength: 100 },
    from_email:  {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
    },
    reply_to: { type: String, trim: true, lowercase: true },

    provider: {
      type: String,
      enum: Object.values(ProviderType),
      default: ProviderType.CUSTOM,
    },

    // ── Auth & OAuth ──────────────────────────────────────────────
    auth_method: {
      type: String,
      enum: ['smtp', 'oauth2'],
      default: 'smtp',
    },
    oauth_refresh_token_enc: { type: String },

    // ── SMTP ──────────────────────────────────────────────────────
    smtp_host:         { type: String, required: true, trim: true },
    smtp_port:         { type: Number, required: true, min: 1, max: 65535, default: 587 },
    smtp_encryption:   {
      type: String,
      enum: Object.values(SmtpEncryption),
      default: SmtpEncryption.TLS,
    },
    smtp_username:     { 
      type: String, 
      trim: true,
      required: function(this: any) { return this.auth_method === 'smtp'; }
    },
    smtp_password_enc: { 
      type: String,
      required: function(this: any) { return this.auth_method === 'smtp'; }
    }, // AES-256-CBC ciphertext

    // ── IMAP ──────────────────────────────────────────────────────
    imap_host:         { type: String, trim: true },
    imap_port:         { type: Number, min: 1, max: 65535, default: 993 },
    imap_encryption:   { type: String, enum: Object.values(SmtpEncryption) },
    imap_username:     { type: String, trim: true },
    imap_password_enc: { type: String }, // AES-256-CBC ciphertext

    // ── Sending limits ────────────────────────────────────────────
    daily_limit:           { type: Number, default: 200,  min: 1, max: 5000 },
    hourly_limit:          { type: Number, default: 50,   min: 1, max: 1000 },
    min_interval_seconds:  { type: Number, default: 60,   min: 0, max: 3600 },

    // ── Stats ─────────────────────────────────────────────────────
    total_sent:      { type: Number, default: 0, min: 0 },
    total_bounced:   { type: Number, default: 0, min: 0 },
    last_used_at:    { type: Date },
    last_verified_at:{ type: Date },
    last_imap_poll_at: { type: Date },

    // ── Status ────────────────────────────────────────────────────
    status:         {
      type: String,
      enum: Object.values(ConnectionStatus),
      default: ConnectionStatus.PENDING,
      index: true,
    },
    failure_reason: { type: String, maxlength: 500 },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'email_connections',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────
// List all connections for a user, filtered by status
EmailConnectionSchema.index({ user_id: 1, status: 1 });
// Unique: one (user, from_email) pair per account
EmailConnectionSchema.index({ user_id: 1, from_email: 1 }, { unique: true });

// ─── Model ────────────────────────────────────────────────────────
export const EmailConnection = model<IEmailConnection>(
  'EmailConnection',
  EmailConnectionSchema
);

/*
 * ── Example Document ─────────────────────────────────────────────
 * {
 *   _id: ObjectId("..."),
 *   user_id: ObjectId("user123"),
 *   label: "My Gmail - Outreach",
 *   from_name: "Shreyas Patil",
 *   from_email: "shreyas@gmail.com",
 *   provider: "gmail",
 *   smtp_host: "smtp.gmail.com",
 *   smtp_port: 587,
 *   smtp_encryption: "tls",
 *   smtp_username: "shreyas@gmail.com",
 *   smtp_password_enc: "a1b2c3...:d4e5f6...",   // "iv:ciphertext"
 *   imap_host: "imap.gmail.com",
 *   imap_port: 993,
 *   imap_encryption: "ssl",
 *   daily_limit: 200,
 *   hourly_limit: 40,
 *   min_interval_seconds: 90,
 *   total_sent: 1542,
 *   total_bounced: 8,
 *   status: "active",
 *   created_at: ISODate("2024-01-01"),
 *   updated_at: ISODate("2024-06-01")
 * }
 */
