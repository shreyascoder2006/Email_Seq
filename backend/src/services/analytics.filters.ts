/**
 * analytics.filters.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 5: Shared Analytics Filter Builder
 * Single source of truth for translating query params → MongoDB match conditions.
 * Every analytics endpoint uses buildAnalyticsFilter() — no duplicated logic.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Types } from 'mongoose';
import { ContactEnrollmentStatus } from '../models/SequenceContact';

// ─── Filter input shape ───────────────────────────────────────────────────────

export interface AnalyticsFilterInput {
  // Date range (ISO strings or YYYY-MM-DD)
  from?:      string;
  to?:        string;
  // Entity scoping
  senderId?:      string;   // EmailConnection._id
  sequenceId?:    string;   // Sequence._id
  status?:        string;   // SequenceContact status or Sequence status
  // Recipient-specific
  search?:        string;   // email substring
  currentStep?:   number;
  opened?:        boolean;
  clicked?:       boolean;
  replied?:       boolean;
  bounced?:       boolean;
  // Sender-specific
  health?:        string;
  // Sequence-specific
  stepIndex?:     number;
  recipientStatus?: string;
}

// ─── Built filter result ──────────────────────────────────────────────────────

export interface BuiltFilter {
  /** MongoDB $match base (user_id already included by caller) */
  dateRange: { from: Date; to: Date };
  /** Optional sequence_id ObjectId constraint */
  sequenceId?: Types.ObjectId;
  /** Optional email_connection_id constraint */
  senderId?: Types.ObjectId;
  /** Optional status constraint */
  status?: string;
  /** Whether any date filter was applied */
  hasDateFilter: boolean;
  /** Raw input for forwarding to sub-helpers */
  raw: AnalyticsFilterInput;
}

// ─── Preset date ranges ───────────────────────────────────────────────────────

export type DatePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'thisMonth' | 'lastMonth';

export function resolveDatePreset(preset: DatePreset): { from: Date; to: Date } {
  const now = new Date();
  const startOfDay = (d: Date) => { d.setHours(0, 0, 0, 0); return d; };
  const endOfDay   = (d: Date) => { d.setHours(23, 59, 59, 999); return d; };

  switch (preset) {
    case 'today': {
      return { from: startOfDay(new Date(now)), to: endOfDay(new Date(now)) };
    }
    case 'yesterday': {
      const d = new Date(now); d.setDate(d.getDate() - 1);
      return { from: startOfDay(d), to: endOfDay(new Date(d)) };
    }
    case 'last7': {
      const d = new Date(now); d.setDate(d.getDate() - 6);
      return { from: startOfDay(d), to: endOfDay(new Date(now)) };
    }
    case 'last30': {
      const d = new Date(now); d.setDate(d.getDate() - 29);
      return { from: startOfDay(d), to: endOfDay(new Date(now)) };
    }
    case 'last90': {
      const d = new Date(now); d.setDate(d.getDate() - 89);
      return { from: startOfDay(d), to: endOfDay(new Date(now)) };
    }
    case 'thisMonth': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(from), to: endOfDay(new Date(now)) };
    }
    case 'lastMonth': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to   = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: startOfDay(from), to: endOfDay(to) };
    }
  }
}

// ─── Phase 5: buildAnalyticsFilter ───────────────────────────────────────────

/**
 * Translates raw query string values into typed, validated filter objects.
 * Called at the top of every analytics service method.
 *
 * Default behaviour (no filters): returns a 30-day window with no entity constraints.
 */
export function buildAnalyticsFilter(input: AnalyticsFilterInput): BuiltFilter {
  const now = new Date();

  // Resolve date range
  let from: Date;
  let to: Date;
  let hasDateFilter = false;

  if (input.from || input.to) {
    hasDateFilter = true;
    from = input.from ? new Date(input.from) : new Date(now.getTime() - 29 * 86400000);
    to   = input.to   ? new Date(input.to)   : now;
    // Normalise to start/end of day
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
  } else {
    // Default: last 30 days (preserves existing behaviour)
    from = new Date(now); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0);
    to   = new Date(now); to.setHours(23, 59, 59, 999);
  }

  const sequenceId = input.sequenceId && Types.ObjectId.isValid(input.sequenceId)
    ? new Types.ObjectId(input.sequenceId) : undefined;

  const senderId = input.senderId && Types.ObjectId.isValid(input.senderId)
    ? new Types.ObjectId(input.senderId) : undefined;

  return {
    dateRange: { from, to },
    sequenceId,
    senderId,
    status: input.status || undefined,
    hasDateFilter,
    raw: input,
  };
}

// ─── Helpers for building MongoDB $match extensions ───────────────────────────

/** Returns a date-range match condition for a given field. */
export function dateMatchForField(field: string, filter: BuiltFilter): Record<string, unknown> {
  return { [field]: { $gte: filter.dateRange.from, $lte: filter.dateRange.to } };
}

/** Adds optional sequence_id constraint to an existing match. */
export function withSequenceId(
  match: Record<string, unknown>,
  filter: BuiltFilter,
): Record<string, unknown> {
  return filter.sequenceId ? { ...match, sequence_id: filter.sequenceId } : match;
}

/** Adds optional email_connection_id constraint to an existing match. */
export function withSenderId(
  match: Record<string, unknown>,
  filter: BuiltFilter,
): Record<string, unknown> {
  return filter.senderId ? { ...match, email_connection_id: filter.senderId } : match;
}

// ─── Recipient filter builder ─────────────────────────────────────────────────

export interface RecipientFilterInput {
  search?:      string;
  status?:      string;
  currentStep?: number;
  page?:        number;
  limit?:       number;
  sortBy?:      'enrolledAt' | 'lastActivityAt' | 'emailsReceived' | 'currentStep';
  sortDir?:     'asc' | 'desc';
}

export function buildRecipientFilter(
  input: RecipientFilterInput,
  baseMatch: Record<string, unknown>,
): Record<string, unknown> {
  const match: Record<string, unknown> = { ...baseMatch };

  if (input.status) {
    // Map to ContactEnrollmentStatus enum value if valid
    const validStatuses = Object.values(ContactEnrollmentStatus) as string[];
    if (validStatuses.includes(input.status)) match.status = input.status;
  }

  if (input.currentStep !== undefined && !isNaN(input.currentStep)) {
    match.current_step_index = input.currentStep;
  }

  if (input.search?.trim()) {
    match.contact_email = { $regex: input.search.trim(), $options: 'i' };
  }

  return match;
}

// ─── Sender filter builder ────────────────────────────────────────────────────

export interface SenderFilterInput {
  health?:  string;
  status?:  string;
  search?:  string;
}
