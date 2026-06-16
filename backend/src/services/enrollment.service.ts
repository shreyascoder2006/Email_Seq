import { Types, FilterQuery } from 'mongoose';
import {
  SequenceContact,
  ISequenceContact,
  ContactEnrollmentStatus,
  UnsubscribeSource,
} from '../models/SequenceContact';
import { Sequence, SequenceStatus } from '../models/Sequence';
import { SequenceStep, ISequenceStep, StepType } from '../models/SequenceStep';
import { AppError } from '../utils/AppError';
import logger from '../config/logger';
import {
  EnrollContactsDto,
  ListContactsQueryDto,
  PatchContactStatusDto,
  EnrollContactItem,
} from '../validators/enrollment.validator';

// ─── Types ─────────────────────────────────────────────────────────
export interface EnrollResult {
  enrolled:   number;
  skipped:    number;
  failed:     number;
  errors:     Array<{ email: string; reason: string }>;
  contacts:   ISequenceContact[];
}

// ─── Sending window helpers ────────────────────────────────────────

/**
 * Given a raw Date, push it forward to the next valid sending window slot.
 * Respects timezone, weekday/all-day schedule, start/end hours.
 */
export function adjustToSendingWindow(
  rawDate: Date,
  window: {
    timezone:    string;
    schedule:    string;
    start_hour:  number;
    end_hour:    number;
    custom_days?: number[];
  }
): Date {
  // Use Intl to get the local time components in the target timezone
  const getLocalParts = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone:    window.timezone,
      hour:        'numeric',
      hour12:      false,
      minute:      'numeric',
      weekday:     'short',
      year:        'numeric',
      month:       '2-digit',
      day:         '2-digit',
    }).formatToParts(d);

    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? '';

    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };

    return {
      hour:    parseInt(get('hour'), 10),
      minute:  parseInt(get('minute'), 10),
      weekday: weekdayMap[get('weekday')] ?? 0,
    };
  };

  const isAllowedDay = (weekday: number): boolean => {
    if (window.schedule === 'all_days') return true;
    if (window.schedule === 'custom') {
      return (window.custom_days ?? []).includes(weekday);
    }
    // weekdays_only: Mon(1) – Fri(5)
    return weekday >= 1 && weekday <= 5;
  };

  let candidate = new Date(rawDate);
  let iterations = 0;
  const MAX_ITER = 60; // safety: never loop more than 60 days forward

  while (iterations++ < MAX_ITER) {
    const { hour, weekday } = getLocalParts(candidate);

    if (!isAllowedDay(weekday)) {
      // Skip to midnight of next day in local tz, then push to window start
      candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
      // Reset to start_hour
      const { hour: h } = getLocalParts(candidate);
      if (h > window.start_hour) {
        candidate = new Date(
          candidate.getTime() + (24 - h + window.start_hour) * 60 * 60 * 1000
        );
      } else if (h < window.start_hour) {
        candidate = new Date(
          candidate.getTime() + (window.start_hour - h) * 60 * 60 * 1000
        );
      }
      continue;
    }

    if (hour < window.start_hour) {
      // Before window — push to start_hour
      candidate = new Date(
        candidate.getTime() + (window.start_hour - hour) * 60 * 60 * 1000
      );
      continue;
    }

    if (hour >= window.end_hour) {
      // After window — push to start_hour next allowed day
      candidate = new Date(candidate.getTime() + (24 - hour + window.start_hour) * 60 * 60 * 1000);
      continue;
    }

    // We're in a valid window
    break;
  }

  return candidate;
}

/**
 * Compute the absolute Date when a step should fire for a contact.
 * base = now (or previous step sent_at), then add step delay.
 */
function computeNextSendAt(
  base: Date,
  step: ISequenceStep,
  sendingWindow: {
    timezone: string;
    schedule: string;
    start_hour: number;
    end_hour: number;
    custom_days?: number[];
  }
): Date {
  const delayMs =
    (step.delay_days  ?? 0) * 24 * 60 * 60 * 1000 +
    (step.delay_hours ?? 0)      * 60 * 60 * 1000;

  const raw = new Date(base.getTime() + delayMs);
  return adjustToSendingWindow(raw, sendingWindow);
}

// ─── Service ───────────────────────────────────────────────────────
export class EnrollmentService {

  // ── Enroll ────────────────────────────────────────────────────────
  async enroll(
    userId: string,
    sequenceId: string,
    dto: EnrollContactsDto
  ): Promise<EnrollResult> {
    // 1. Load sequence — must be active
    const seq = await Sequence.findOne({ _id: sequenceId, user_id: userId });
    if (!seq) throw AppError.notFound('Sequence');

    if (seq.status !== SequenceStatus.ACTIVE) {
      throw AppError.badRequest(
        `Sequence must be "active" to enroll contacts. Current status: "${seq.status}"`
      );
    }

    // 2. Load ordered active steps
    const steps = await SequenceStep.find({
      sequence_id: sequenceId,
      is_active:   true,
    }).sort({ step_index: 1 });

    if (steps.length === 0) {
      throw AppError.badRequest(
        'Sequence has no active steps. Add at least one email step.'
      );
    }

    // First active email step (step 0 may be a condition/wait)
    const firstEmailStep = steps.find((s) => s.type === StepType.EMAIL);
    if (!firstEmailStep) {
      throw AppError.badRequest(
        'Sequence has no active email steps. Add at least one email step.'
      );
    }

    // 3. Check already-enrolled contacts
    const emails = dto.contacts.map((c) => c.email.toLowerCase());
    const existing = await SequenceContact.find({
      sequence_id:    sequenceId,
      contact_email:  { $in: emails },
    }).select('contact_email status').lean();

    const existingMap = new Map(existing.map((e) => [e.contact_email, e.status]));

    // 4. Compute base start time
    const startBase = dto.start_at ? new Date(dto.start_at) : new Date();

    // 5. Build insertable contact docs
    const result: EnrollResult = {
      enrolled: 0,
      skipped:  0,
      failed:   0,
      errors:   [],
      contacts: [],
    };

    const docsToInsert: Partial<ISequenceContact>[] = [];

    for (const contact of dto.contacts) {
      const email = contact.email.toLowerCase();

      if (existingMap.has(email)) {
        if (dto.skip_existing) {
          result.skipped++;
          continue;
        }
        result.failed++;
        result.errors.push({
          email,
          reason: `Already enrolled with status "${existingMap.get(email)}"`,
        });
        continue;
      }

      // Compute next_send_at for the first step
      const nextSendAt = computeNextSendAt(
        startBase,
        firstEmailStep,
        seq.sending_window as any
      );

      docsToInsert.push({
        sequence_id:         new Types.ObjectId(sequenceId),
        user_id:             new Types.ObjectId(userId),
        email_connection_id: seq.email_connection_id,
        contact_email:       email,
        contact_first_name:  contact.first_name || '',
        contact_last_name:   contact.last_name,
        contact_company:     contact.company,
        custom_variables:    new Map(Object.entries(contact.custom_variables ?? {})),
        status:              ContactEnrollmentStatus.ACTIVE,
        next_send_at:        nextSendAt,
        current_step_index:  firstEmailStep.step_index,
        total_steps:         steps.length,
        step_records:        [],
        has_opened:          false,
        has_clicked:         false,
        has_replied:         false,
        consecutive_failures: 0,
        enrolled_at:         new Date(),
      });
    }

    if (dto.contacts.length > 0 && result.failed > 0 && !dto.skip_existing) {
      throw AppError.conflict(
        `${result.failed} contact(s) already enrolled: ` +
        result.errors.map((e) => e.email).join(', ')
      );
    }

    // 6. Bulk insert (transactions removed for standalone MongoDB)
    if (docsToInsert.length > 0) {
      let inserted: ISequenceContact[] = [];
      try {
        const rawResult: any = await SequenceContact.insertMany(docsToInsert, {
          ordered:    false, // continue on individual failures
          lean:       false,
        });

        if (Array.isArray(rawResult)) {
          inserted = rawResult;
        } else if (rawResult && rawResult.insertedIds) {
          // Mongoose 8.x ordered:false returns raw driver result
          const ids = Object.values(rawResult.insertedIds);
          inserted = await SequenceContact.find({ _id: { $in: ids } });
        }
      } catch (insertErr: any) {
        logger.error('DEBUG ENROLLMENT: insertMany failed', { err: insertErr.message, name: insertErr.name });
        if (insertErr.name === 'BulkWriteError' && insertErr.insertedDocs) {
          inserted = insertErr.insertedDocs;
        } else if (insertErr.name === 'ValidationError') {
          throw insertErr;
        } else {
          throw insertErr;
        }
      }

      result.enrolled  = inserted.length;
      result.contacts  = inserted;

      // Update sequence stats
      if (inserted.length > 0) {
        await Sequence.updateOne(
          { _id: sequenceId },
          {
            $inc: {
              'stats.total_contacts':  inserted.length,
              'stats.active_contacts': inserted.length,
            },
          }
        );
      }

      logger.info('Contacts enrolled', {
        sequenceId,
        userId,
        enrolled: result.enrolled,
        skipped:  result.skipped,
        failed:   result.failed,
      });
    }

    return result;
  }

  // ── List contacts ─────────────────────────────────────────────────
  async listContacts(
    userId: string,
    sequenceId: string,
    query: ListContactsQueryDto
  ): Promise<{
    contacts:   ISequenceContact[];
    total:      number;
    page:       number;
    totalPages: number;
  }> {
    // Verify ownership
    const seq = await Sequence.findOne({ _id: sequenceId, user_id: userId });
    if (!seq) throw AppError.notFound('Sequence');

    const filter: FilterQuery<ISequenceContact> = { sequence_id: sequenceId };
    if (query.status) filter.status = query.status;
    if (query.search) {
      filter.$or = [
        { contact_email:      { $regex: query.search, $options: 'i' } },
        { contact_first_name: { $regex: query.search, $options: 'i' } },
        { contact_last_name:  { $regex: query.search, $options: 'i' } },
      ];
    }

    const skip = (query.page - 1) * query.limit;
    const [contacts, total] = await Promise.all([
      SequenceContact.find(filter)
        .sort({ enrolled_at: -1 })
        .skip(skip)
        .limit(query.limit)
        .lean<ISequenceContact[]>(),
      SequenceContact.countDocuments(filter),
    ]);

    return {
      contacts,
      total,
      page:       query.page,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  // ── Pause / Resume a contact ──────────────────────────────────────
  async patchContactStatus(
    userId:    string,
    sequenceId: string,
    contactId: string,
    dto:       PatchContactStatusDto
  ): Promise<ISequenceContact> {
    // Verify sequence ownership
    const seq = await Sequence.findOne({ _id: sequenceId, user_id: userId });
    if (!seq) throw AppError.notFound('Sequence');

    const contact = await SequenceContact.findOne({
      _id:         contactId,
      sequence_id: sequenceId,
    });
    if (!contact) throw AppError.notFound('Contact enrollment');

    // Only active ↔ paused transitions allowed here
    const terminal: string[] = [
      ContactEnrollmentStatus.COMPLETED,
      ContactEnrollmentStatus.BOUNCED,
      ContactEnrollmentStatus.UNSUBSCRIBED,
    ];
    if (terminal.includes(contact.status)) {
      throw AppError.badRequest(
        `Cannot change status of a "${contact.status}" contact.`
      );
    }

    const originalStatus = contact.status;

    if (dto.status === 'removed') {
      contact.status    = ContactEnrollmentStatus.REMOVED;
      contact.next_send_at = null;
      if (dto.reason) contact.last_error = dto.reason;

      // Decrement active contacts if it was active
      if (originalStatus === ContactEnrollmentStatus.ACTIVE) {
        await Sequence.updateOne(
          { _id: sequenceId },
          { $inc: { 'stats.active_contacts': -1 } }
        );
      }
    } else if (dto.status === 'paused') {
      contact.status    = ContactEnrollmentStatus.PAUSED;
      contact.paused_at = new Date();
      if (dto.reason) contact.last_error = dto.reason;

      if (originalStatus === ContactEnrollmentStatus.ACTIVE) {
        await Sequence.updateOne(
          { _id: sequenceId },
          { $inc: { 'stats.active_contacts': -1 } }
        );
      }
    } else {
      // Resume → re-activate
      contact.status    = ContactEnrollmentStatus.ACTIVE;
      contact.paused_at = undefined;
      // If next_send_at was in the past, bump it to now so scheduler picks it up immediately
      if (!contact.next_send_at || contact.next_send_at <= new Date()) {
        contact.next_send_at = new Date();
      }

      if (originalStatus !== ContactEnrollmentStatus.ACTIVE) {
        await Sequence.updateOne(
          { _id: sequenceId },
          { $inc: { 'stats.active_contacts': 1 } }
        );
      }
    }

    await contact.save();

    logger.info('Contact status patched', {
      contactId,
      sequenceId,
      status: dto.status,
      userId,
    });

    return contact;
  }

  // ── Remove / Unsubscribe a contact ────────────────────────────────
  async unsubscribeContact(
    sequenceContactId: string,
    source: UnsubscribeSource = UnsubscribeSource.LINK
  ): Promise<void> {
    const contact = await SequenceContact.findById(sequenceContactId);
    if (!contact) return;

    contact.status             = ContactEnrollmentStatus.UNSUBSCRIBED;
    contact.unsubscribed_at    = new Date();
    contact.unsubscribe_source = source;
    contact.next_send_at       = null;

    await contact.save();

    await Sequence.updateOne(
      { _id: contact.sequence_id },
      {
        $inc: {
          'stats.active_contacts': -1,
          'stats.unsubscribed':     1,
        },
      }
    );

    logger.info('Contact unsubscribed', {
      contactId: sequenceContactId,
      source,
    });
  }

  // ── Advance contact to next step (called after successful send) ───
  async advanceContact(
    contact: ISequenceContact,
    sentStepIndex: number,
    messageId: string,
    allSteps: ISequenceStep[],
    sendingWindow: {
      timezone: string;
      schedule: string;
      start_hour: number;
      end_hour: number;
      custom_days?: number[];
    }
  ): Promise<void> {
    // Record this step as sent
    const stepRecord = contact.step_records.find(
      (r) => r.step_index === sentStepIndex
    );
    if (stepRecord) {
      stepRecord.status    = 'sent';
      stepRecord.sent_at   = new Date();
      stepRecord.message_id = messageId;
    } else {
      contact.step_records.push({
        step_index:  sentStepIndex,
        step_id:     allSteps[sentStepIndex]._id as Types.ObjectId,
        status:      'sent',
        sent_at:     new Date(),
        message_id:  messageId,
      });
    }

    // Find next active email step
    const remainingSteps = allSteps.filter(
      (s) => s.step_index > sentStepIndex && s.is_active && s.type === StepType.EMAIL
    );

    if (remainingSteps.length === 0) {
      // No more steps — mark completed
      contact.status        = ContactEnrollmentStatus.COMPLETED;
      contact.next_send_at  = null;
      contact.completed_at  = new Date();

      await Sequence.updateOne(
        { _id: contact.sequence_id },
        {
          $inc: {
            'stats.active_contacts': -1,
            'stats.completed':        1,
          },
        }
      );
    } else {
      const nextStep = remainingSteps[0];
      contact.current_step_index = nextStep.step_index;
      contact.next_send_at       = computeNextSendAt(
        new Date(),
        nextStep,
        sendingWindow
      );
    }

    contact.consecutive_failures = 0;
    await contact.save();
  }
}

export const enrollmentService = new EnrollmentService();
export { computeNextSendAt };
