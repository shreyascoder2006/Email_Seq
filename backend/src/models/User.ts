/**
 * src/models/User.ts
 *
 * Minimal User model — supports billing entitlements and future auth extension.
 *
 * DESIGN DECISIONS:
 *
 * 1. The existing mock auth flow (auth.controller.ts) issues JWTs with a hardcoded
 *    userId = '507f1f77bcf86cd799439011' and is NOT modified by this model.
 *    A dev seed utility (ensureDevUser) is exported for use during server bootstrap
 *    to guarantee the development user document exists with plan = 'free' before
 *    any payment operation could reference it.
 *
 * 2. password_hash is optional — the current mock auth does not use real passwords.
 *    The field is present so a real auth system can be added later without migration.
 *
 * 3. plan_expires_at is optional — the initial PRO purchase is a one-time test
 *    transaction with no expiry. The field is present so subscriptions can be
 *    introduced later without a destructive migration.
 *
 * 4. No payment logic lives in this model — it is a plain entitlement store.
 */

import { Schema, model, Document, Types } from 'mongoose';

// ─── Enums ─────────────────────────────────────────────────────────────
export enum UserRole {
  ADMIN = 'admin',
  USER  = 'user',
}

export enum UserPlan {
  FREE = 'free',
  PRO  = 'pro',
}

// ─── TypeScript Interface ───────────────────────────────────────────────
export interface IUser extends Document {
  _id:               Types.ObjectId;
  email:             string;
  name:              string;
  role:              UserRole;
  password_hash?:    string;        // optional — mock auth uses no password

  // ─── Plan / Entitlement ───────────────────────────────────────
  // plan defaults to 'free'. Upgraded to 'pro' after verified payment.
  // Design supports future tiers without schema change.
  plan:              UserPlan;
  plan_started_at?:  Date;          // set when plan is first activated
  plan_expires_at?:  Date;          // null = lifetime; set for future subscriptions

  created_at:        Date;
  updated_at:        Date;
}

// ─── Schema ────────────────────────────────────────────────────────────
const UserSchema = new Schema<IUser>(
  {
    email: {
      type:      String,
      required:  true,
      unique:    true,
      trim:      true,
      lowercase: true,
    },

    name: {
      type:     String,
      required: true,
      trim:     true,
      default:  'User',
    },

    role: {
      type:    String,
      enum:    Object.values(UserRole),
      default: UserRole.USER,
    },

    // Optional — present for future real auth; unused by mock auth.
    password_hash: {
      type:   String,
      select: false,  // never returned in queries by default
    },

    // ─── Plan fields ───────────────────────────────────────────────
    plan: {
      type:    String,
      enum:    Object.values(UserPlan),
      default: UserPlan.FREE,
    },

    plan_started_at: {
      type: Date,
    },

    plan_expires_at: {
      type: Date,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'users',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────────
// Email uniqueness is enforced above via `unique: true`.
// Index on plan for future entitlement queries (e.g. find all pro users).
UserSchema.index({ plan: 1 });

// ─── Model ─────────────────────────────────────────────────────────────
export const User = model<IUser>('User', UserSchema);

// ─── Dev Compatibility Utility ─────────────────────────────────────────
/**
 * ensureDevUser()
 *
 * Called once at server bootstrap (in development mode only) by server.ts.
 *
 * WHY THIS EXISTS:
 *   The mock auth controller issues JWTs with a hardcoded ObjectId:
 *     userId = '507f1f77bcf86cd799439011'
 *
 *   All payment operations will look up and update this User document.
 *   If the document does not exist before the first payment attempt, the
 *   payment service would fail or upsert an incomplete record.
 *
 *   This function creates the development user document idempotently
 *   (upsert: true, no error if it already exists) so that the user is
 *   available with plan = 'free' before any billing endpoint is called.
 *
 * SAFETY:
 *   - Only runs in NODE_ENV = 'development'.
 *   - Uses a fixed ObjectId that matches the mock auth controller exactly.
 *   - Does NOT modify the auth controller or JWT issuance logic.
 *   - Is a no-op if the document already exists.
 *   - Errors are caught and logged, never thrown — server startup is not blocked.
 */
export const DEV_USER_ID = '507f1f77bcf86cd799439011';

export async function ensureDevUser(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') return;

  try {
    await User.findOneAndUpdate(
      { _id: DEV_USER_ID },
      {
        $setOnInsert: {
          _id:   DEV_USER_ID,
          email: 'dev@localhost',
          name:  'Dev User',
          role:  UserRole.USER,
          plan:  UserPlan.FREE,
        },
      },
      { upsert: true, new: true }
    );
    // Intentionally silent on success — only log if something goes wrong.
  } catch (err) {
    // Non-fatal: log warning but do not crash the server.
    // Payment endpoints will surface a clear error if the user is still missing.
    console.warn(
      '[ensureDevUser] Could not ensure dev user document:',
      (err as Error).message
    );
  }
}
