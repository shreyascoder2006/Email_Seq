import { Types, FilterQuery } from 'mongoose';
import {
  SequenceContact,
  ISequenceContact,
  ContactEnrollmentStatus,
  UnsubscribeSource,
} from '../models/SequenceContact';
import { Sequence, SequenceStatus } from '../models/Sequence';
import { SequenceStep, ISequenceStep, StepType } from '../models/SequenceStep';
import { AuditLog } from '../models/AuditLog';
import { AppError } from '../utils/AppError';
import logger from '../config/logger';
import {
  EnrollContactsDto,
  ListContactsQueryDto,
  PatchContactStatusDto,
  EnrollContactItem,
  BulkContactActionDto,
} from '../validators/enrollment.validator';
import { enqueueEmailJob } from '../queues/emailQueue';

// ─── Types ─────────────────────────────────────────────────────────
export interface EnrollResult {
  enrolled:   number;
  skipped:    number;
  failed:     number;
  errors:     Array<{ email: string; reason: string }>;
  contacts:   ISequenceContact[];
  isOutsideWindow?: boolean;
  nextAvailableWindow?: string;
}

import { calculateNextValidSlot } from '../utils/scheduling';

/**
 * Compute the absolute Date when a step should fire for a contact.
 * base = now (or previous step sent_at), then add step delay.
 */
function computeNextSendAt(
  base: Date,
  step: ISequenceStep,
  sendingWindow: any,
  launchDate?: Date
): Date {
  const delayMs =
    (step.delay_days  ?? 0) * 24 * 60 * 60 * 1000 +
    (step.delay_hours ?? 0)      * 60 * 60 * 1000;

  const raw = new Date(base.getTime() + delayMs);
  return calculateNextValidSlot(raw, sendingWindow, launchDate);
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

    if ([SequenceStatus.COMPLETED, SequenceStatus.ARCHIVED].includes(seq.status)) {
      throw AppError.badRequest(
        `Cannot enroll contacts to a sequence with status: "${seq.status}"`
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

    // 4. Global re-enrollment guard: a contact that previously unsubscribed from ANY
    // sequence belonging to this user cannot be re-enrolled. Scoped per-user to
    // prevent cross-tenant contamination.
    const globalUnsubbed = await SequenceContact.find({
      user_id:       new Types.ObjectId(userId),
      contact_email: { $in: emails },
      status:        ContactEnrollmentStatus.UNSUBSCRIBED,
    }).select('contact_email').lean();
    const unsubscribedSet = new Set(globalUnsubbed.map(c => c.contact_email));

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

      // Re-enrollment guard: never re-add a globally unsubscribed contact
      if (unsubscribedSet.has(email)) {
        result.skipped++;
        result.errors.push({ email, reason: 'Previously unsubscribed — cannot re-enroll' });
        continue;
      }

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
        seq.sending_window,
        seq.launch_date
      );

      docsToInsert.push({
        sequence_id:         new Types.ObjectId(sequenceId),
        user_id:             new Types.ObjectId(userId),
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
        await this.recomputeSequenceStats(sequenceId);
      }

      // Add detailed logging for the enrolled contacts
      for (const contactDoc of inserted) {
        logger.info('DEBUG ENROLLMENT:', {
          contactId: contactDoc._id.toString(),
          sequenceId: contactDoc.sequence_id.toString(),
          current_step_index: contactDoc.current_step_index,
          next_send_at: contactDoc.next_send_at?.toISOString(),
          enrolled_at: contactDoc.enrolled_at.toISOString(),
          delay_days: firstEmailStep.delay_days,
          delay_hours: firstEmailStep.delay_hours,
          step_type: firstEmailStep.type,
          total_steps: contactDoc.total_steps,
        });
        
        // Enqueue delayed job immediately
        if (contactDoc.next_send_at) {
          enqueueEmailJob(
            contactDoc._id.toString(),
            contactDoc.current_step_index,
            contactDoc.next_send_at,
            contactDoc.sequence_id.toString(),
            contactDoc.schedule_version,
            'enrollment'
          ).then(async (jobId) => {
            if (jobId) {
              await SequenceContact.updateOne(
                { _id: contactDoc._id },
                { $set: { current_job_id: jobId, job_scheduled_at: new Date() } }
              );
            }
          }).catch(err => {
            logger.error('Failed to enqueue job for newly enrolled contact', {
              contactId: contactDoc._id.toString(),
              sequenceId: contactDoc.sequence_id.toString(),
              queueName: 'email-sequence',
              error: {
                name: err.name,
                message: err.message,
                stack: err.stack,
              }
            });
          });
        }
      }

      logger.info('Contacts enrolled', {
        sequenceId,
        userId,
        enrolled: result.enrolled,
        skipped:  result.skipped,
        failed:   result.failed,
      });
    }

    const now = new Date();
    const nextValid = calculateNextValidSlot(now, seq.sending_window as any, seq.launch_date);
    const isOutsideWindow = nextValid.getTime() > now.getTime();
    
    const startHour = seq.sending_window?.start_hour ?? 9;
    const startMinute = seq.sending_window?.start_minute ?? 0;
    const ampm = startHour >= 12 ? 'PM' : 'AM';
    const displayHour = startHour % 12 === 0 ? 12 : startHour % 12;
    const displayMinute = startMinute.toString().padStart(2, '0');
    const nextAvailableWindow = `${displayHour.toString().padStart(2, '0')}:${displayMinute} ${ampm}`;

    result.isOutsideWindow = isOutsideWindow;
    result.nextAvailableWindow = nextAvailableWindow;

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
        contact.next_send_at = calculateNextValidSlot(new Date(), seq.sending_window as any, seq.launch_date);
      }
    }

    await contact.save();
    
    // Recompute sequence stats to reflect the status change
    await this.recomputeSequenceStats(sequenceId);

    // Enqueue if resumed
    if (contact.status === ContactEnrollmentStatus.ACTIVE && contact.next_send_at) {
      enqueueEmailJob(
        contact._id.toString(),
        contact.current_step_index,
        contact.next_send_at,
        contact.sequence_id.toString(),
        contact.schedule_version,
        'resume'
      ).then(async (jobId) => {
        if (jobId) {
          await SequenceContact.updateOne(
            { _id: contact._id },
            { $set: { current_job_id: jobId, job_scheduled_at: new Date() } }
          );
        }
      }).catch(err => {
        logger.error('Failed to enqueue job on resume', {
          contactId: contactId.toString(),
          sequenceId: contact.sequence_id.toString(),
          queueName: 'email-sequence',
          error: {
            name: err.name,
            message: err.message,
            stack: err.stack,
          }
        });
      });
    }

    logger.info('Contact status patched', {
      contactId,
      sequenceId,
      status: dto.status,
      userId,
    });

    return contact;
  }

  // ── Bulk Delete ───────────────────────────────────────────────────
  async bulkDelete(
    userId: string,
    sequenceId: string,
    dto: BulkContactActionDto
  ): Promise<{ deleted: number; updatedStats: { total_contacts: number; active_contacts: number; paused_contacts: number; completed: number } }> {
    const seq = await Sequence.findOne({ _id: sequenceId, user_id: userId });
    if (!seq) throw AppError.notFound('Sequence');

    const contacts = await SequenceContact.find({
      _id: { $in: dto.contactIds },
      sequence_id: sequenceId
    });

    if (contacts.length === 0) return { deleted: 0, updatedStats: { total_contacts: 0, active_contacts: 0, paused_contacts: 0, completed: 0 } };

    await SequenceContact.deleteMany({
      _id: { $in: contacts.map(c => c._id) },
      sequence_id: sequenceId
    });

    const updatedStats = await this.recomputeSequenceStats(sequenceId);

    logger.info('Bulk deleted contacts', { sequenceId, userId, count: contacts.length });
    return { deleted: contacts.length, updatedStats };
  }

  // ── Bulk Pause ────────────────────────────────────────────────────
  async bulkPause(
    userId: string,
    sequenceId: string,
    dto: BulkContactActionDto
  ): Promise<{ paused: number; updatedStats: { total_contacts: number; active_contacts: number; paused_contacts: number; completed: number } }> {
    const seq = await Sequence.findOne({ _id: sequenceId, user_id: userId });
    if (!seq) throw AppError.notFound('Sequence');

    const contacts = await SequenceContact.find({
      _id: { $in: dto.contactIds },
      sequence_id: sequenceId,
      status: ContactEnrollmentStatus.ACTIVE // only active can be paused
    });

    if (contacts.length === 0) return { paused: 0, updatedStats: { total_contacts: 0, active_contacts: 0, paused_contacts: 0, completed: 0 } };

    await SequenceContact.updateMany(
      { _id: { $in: contacts.map(c => c._id) } },
      { 
        $set: { 
          status: ContactEnrollmentStatus.PAUSED, 
          paused_at: new Date() 
        } 
      }
    );

    const updatedStats = await this.recomputeSequenceStats(sequenceId);

    logger.info('Bulk paused contacts', { sequenceId, userId, count: contacts.length });
    return { paused: contacts.length, updatedStats };
  }

  // ── Bulk Resume ───────────────────────────────────────────────────
  async bulkResume(
    userId: string,
    sequenceId: string,
    dto: BulkContactActionDto
  ): Promise<{ resumed: number; updatedStats: { total_contacts: number; active_contacts: number; paused_contacts: number; completed: number } }> {
    const seq = await Sequence.findOne({ _id: sequenceId, user_id: userId });
    if (!seq) throw AppError.notFound('Sequence');

    const contacts = await SequenceContact.find({
      _id: { $in: dto.contactIds },
      sequence_id: sequenceId,
      status: ContactEnrollmentStatus.PAUSED // only paused can be resumed
    });

    if (contacts.length === 0) return { resumed: 0, updatedStats: { total_contacts: 0, active_contacts: 0, paused_contacts: 0, completed: 0 } };

    const now = new Date();
    const nextValidSlot = calculateNextValidSlot(now, seq.sending_window as any, seq.launch_date);

    await SequenceContact.updateMany(
      { _id: { $in: contacts.map(c => c._id) } },
      { 
        $set: { 
          status: ContactEnrollmentStatus.ACTIVE, 
          next_send_at: nextValidSlot 
        },
        $unset: { paused_at: "" }
      }
    );

    const updatedStats = await this.recomputeSequenceStats(sequenceId);

    // Enqueue delayed jobs for all resumed contacts
    for (const c of contacts) {
      enqueueEmailJob(
        c._id.toString(),
        c.current_step_index,
        nextValidSlot,
        c.sequence_id.toString(),
        c.schedule_version,
        'bulk_resume'
      ).then(async (jobId) => {
        if (jobId) {
          await SequenceContact.updateOne(
            { _id: c._id },
            { $set: { current_job_id: jobId, job_scheduled_at: new Date() } }
          );
        }
      }).catch(err => {
        logger.error('Failed to enqueue job on bulk resume', {
          contactId: c._id.toString(),
          sequenceId: c.sequence_id.toString(),
          queueName: 'email-sequence',
          error: {
            name: err.name,
            message: err.message,
            stack: err.stack,
          }
        });
      });
    }

    logger.info('Bulk resumed contacts', { sequenceId, userId, count: contacts.length });
    return { resumed: contacts.length, updatedStats };
  }

  // ── Bulk Skip ─────────────────────────────────────────────────────
  async bulkSkip(
    userId: string,
    sequenceId: string,
    dto: BulkContactActionDto
  ): Promise<{ skipped: number; updatedStats: { total_contacts: number; active_contacts: number; paused_contacts: number; completed: number } }> {
    const seq = await Sequence.findOne({ _id: sequenceId, user_id: userId });
    if (!seq) throw AppError.notFound('Sequence');

    const contacts = await SequenceContact.find({
      _id: { $in: dto.contactIds },
      sequence_id: sequenceId,
    });

    if (contacts.length === 0) return { skipped: 0, updatedStats: { total_contacts: 0, active_contacts: 0, paused_contacts: 0, completed: 0 } };

    await SequenceContact.updateMany(
      { _id: { $in: contacts.map(c => c._id) } },
      { 
        $set: { 
          status: ContactEnrollmentStatus.SKIPPED, 
          next_send_at: null 
        } 
      }
    );

    const updatedStats = await this.recomputeSequenceStats(sequenceId);

    logger.info('Bulk skipped contacts', { sequenceId, userId, count: contacts.length });
    return { skipped: contacts.length, updatedStats };
  }

  // ── Remove / Unsubscribe a contact ────────────────────────────────
  /**
   * Atomically marks a contact as unsubscribed.
   * Increments schedule_version so any pending BullMQ delayed jobs are
   * silently discarded by the worker's version check — no direct queue mutation.
   * Safe to call concurrently: the $ne condition ensures only one caller wins.
   */
  async unsubscribeContact(
    sequenceContactId: string,
    source: UnsubscribeSource = UnsubscribeSource.LINK,
    opts?: { reason?: string; ip?: string; userAgent?: string }
  ): Promise<void> {
    const updated = await SequenceContact.findOneAndUpdate(
      { _id: sequenceContactId, status: { $ne: ContactEnrollmentStatus.UNSUBSCRIBED } },
      {
        $set: {
          status:             ContactEnrollmentStatus.UNSUBSCRIBED,
          unsubscribed_at:    new Date(),
          unsubscribe_source: source,
          next_send_at:       null,
          sending_locked:     false,
          current_job_id:     null,
          ...(opts?.reason    ? { unsubscribe_reason: opts.reason }       : {}),
          ...(opts?.ip        ? { unsubscribe_ip: opts.ip }               : {}),
          ...(opts?.userAgent ? { unsubscribe_user_agent: opts.userAgent } : {}),
        },
        $inc: { schedule_version: 1 },
      },
      { new: true }
    );

    // Only update sequence stats if we were the first to unsubscribe this contact
    if (updated) {
      await Sequence.updateOne(
        { _id: updated.sequence_id },
        { $inc: { 'stats.unsubscribed': 1 } }
      );
      logger.info('Contact unsubscribed', { contactId: sequenceContactId, source });
    }
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
    },
    launchDate?: Date
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
        new Date(), // The base time for follow-up is the time of successful send (now)
        nextStep,
        sendingWindow,
        launchDate
      );
    }

    contact.consecutive_failures = 0;
    await contact.save();
  }

  // ── Recompute Sequence Stats ────────────────────────────────────────
  async recomputeSequenceStats(sequenceId: string): Promise<{
    total_contacts: number;
    active_contacts: number;
    paused_contacts: number;
    completed: number;
  }> {
    const contacts = await SequenceContact.find({ sequence_id: sequenceId }).lean();

    let total = 0;
    let active = 0;
    let paused = 0;
    let completed = 0;

    contacts.forEach((c) => {
      // total_contacts = contacts that are not removed or skipped
      if (c.status !== ContactEnrollmentStatus.REMOVED && c.status !== ContactEnrollmentStatus.SKIPPED) {
        total++;
      }
      if (c.status === ContactEnrollmentStatus.ACTIVE) active++;
      if (c.status === ContactEnrollmentStatus.PAUSED) paused++;
      if (c.status === ContactEnrollmentStatus.COMPLETED) completed++;
    });

    const stats = { total_contacts: total, active_contacts: active, paused_contacts: paused, completed };

    await Sequence.updateOne(
      { _id: sequenceId },
      {
        $set: {
          'stats.total_contacts': stats.total_contacts,
          'stats.active_contacts': stats.active_contacts,
          'stats.paused_contacts': stats.paused_contacts,
          'stats.completed': stats.completed,
        },
      }
    );

    return stats;
  }

  // ── Reschedule Campaign ───────────────────────────────────────────
  async rescheduleContacts(
    userId: string,
    sequenceId: string,
    contactIds: string[],
    rescheduleOpts: {
      action: 'immediately' | 'today' | 'tomorrow' | 'custom';
      launch_date?: string;
      start_hour?: number;
      start_minute?: number;
      end_hour?: number;
      end_minute?: number;
      browser_timezone: string;
    }
  ) {
    const seq = await Sequence.findOne({ _id: sequenceId, user_id: userId }).lean();
    if (!seq) throw new AppError('Sequence not found or permission denied', 404);

    const validStatuses = [
      ContactEnrollmentStatus.ACTIVE,
      ContactEnrollmentStatus.PAUSED,
    ];

    const contacts = await SequenceContact.find({
      _id: { $in: contactIds },
      sequence_id: sequenceId,
      status: { $in: validStatuses },
    });

    const result = {
      updated: 0,
      skipped: 0,
      failed: 0,
      updated_contacts: [] as string[],
      skipped_contacts: [] as string[],
      failed_contacts: [] as string[],
    };

    const requestedSet = new Set(contactIds.map(id => id.toString()));
    const validSet = new Set(contacts.map(c => c._id.toString()));
    for (const id of requestedSet) {
      if (!validSet.has(id)) {
        result.skipped++;
        result.skipped_contacts.push(id);
      }
    }

    // Determine the base window for calculations
    const window = { ...seq.sending_window } as any;

    if (rescheduleOpts.action === 'custom') {
      if (rescheduleOpts.start_hour !== undefined) window.start_hour = rescheduleOpts.start_hour;
      if (rescheduleOpts.start_minute !== undefined) window.start_minute = rescheduleOpts.start_minute;
      if (rescheduleOpts.end_hour !== undefined) window.end_hour = rescheduleOpts.end_hour;
      if (rescheduleOpts.end_minute !== undefined) window.end_minute = rescheduleOpts.end_minute;
      window.timezone = rescheduleOpts.browser_timezone;
    } else {
      window.timezone = rescheduleOpts.browser_timezone;
    }

    const { DateTime } = await import('luxon');
    let baseDate = new Date();
    
    if (rescheduleOpts.action === 'tomorrow') {
      baseDate = DateTime.now().setZone(window.timezone).plus({ days: 1 }).startOf('day').toJSDate();
    } else if (rescheduleOpts.action === 'custom' && rescheduleOpts.launch_date) {
      baseDate = DateTime.fromISO(rescheduleOpts.launch_date, { zone: window.timezone }).startOf('day').toJSDate();
    }

    // Calculate nextValidSlot once since it applies to all contacts being rescheduled identically
    let nextValidSlot = new Date();
    if (rescheduleOpts.action === 'immediately') {
      nextValidSlot = new Date();
    } else {
      nextValidSlot = calculateNextValidSlot(baseDate, window, undefined);
    }

    const auditDetails: any[] = [];

    for (const c of contacts) {
      try {
        const expectedVersion = c.schedule_version || 1;

        // 1. Optimistic Lock & Mongo Update
        const updatedDoc = await SequenceContact.findOneAndUpdate(
          { 
            _id: c._id, 
            sending_locked: false, 
            schedule_version: expectedVersion 
          },
          {
            $set: {
              next_send_at: nextValidSlot,
              current_job_id: null,
              job_scheduled_at: null,
              last_rescheduled_at: new Date(),
              last_rescheduled_by: new Types.ObjectId(userId),
            },
            $inc: { schedule_version: 1 }
          },
          { new: true }
        );

        if (!updatedDoc) {
          result.failed++;
          result.failed_contacts.push(c._id.toString());
          continue;
        }

        // Record for audit log
        auditDetails.push({
          contact_id: c._id,
          previous_next_send_at: c.next_send_at,
          new_next_send_at: updatedDoc.next_send_at,
          previous_schedule_version: expectedVersion,
          new_schedule_version: updatedDoc.schedule_version,
        });

        // 2. Enqueue BullMQ Job
        const jobId = await enqueueEmailJob(
          c._id.toString(),
          c.current_step_index,
          nextValidSlot,
          c.sequence_id.toString(),
          updatedDoc.schedule_version,
          'reschedule'
        ).catch(err => {
          logger.error('Reschedule enqueueEmailJob failed', { contactId: c._id, err: err.message });
          return null;
        });

        if (jobId) {
          // 3. Update Mongo with job ID
          await SequenceContact.updateOne(
            { _id: c._id },
            { $set: { current_job_id: jobId, job_scheduled_at: new Date() } }
          );
        }

        result.updated++;
        result.updated_contacts.push(c._id.toString());
      } catch (err: any) {
        logger.error('Reschedule failed for contact', { contactId: c._id, err: err.message });
        result.failed++;
        result.failed_contacts.push(c._id.toString());
      }
    }

    if (result.updated > 0) {
      await AuditLog.create({
        user_id: new Types.ObjectId(userId),
        sequence_id: seq._id,
        action_type: 'reschedule_campaign',
        browser_timezone: rescheduleOpts.browser_timezone,
        affected_contacts_count: result.updated,
        details: { action: rescheduleOpts.action, updates: auditDetails }
      });
    }

    return result;
  }

  // ── Bulk Remove (soft-delete → REMOVED status) ────────────────────
  async bulkRemove(userId: string, sequenceId: string, dto: BulkContactActionDto) {
    const seqOid = new Types.ObjectId(sequenceId);
    const uid    = new Types.ObjectId(userId);
    const match  = dto.contactIds?.length
      ? { _id: { $in: dto.contactIds.map((id: string) => new Types.ObjectId(id)) }, sequence_id: seqOid, user_id: uid }
      : { sequence_id: seqOid, user_id: uid, ...(dto.filter_status ? { status: dto.filter_status } : {}) };

    const result = await SequenceContact.updateMany(match, {
      $set: { status: ContactEnrollmentStatus.REMOVED, next_send_at: null }
    });
    const removed = result.modifiedCount;
    await AuditLog.create({
      user_id: uid, sequence_id: seqOid,
      action_type: 'bulk_remove', browser_timezone: 'UTC',
      affected_contacts_count: removed,
      details: { contactIds: dto.contactIds }
    });
    return { removed };
  }


  // ── Bulk Re-enroll (FAILED/BOUNCED/COMPLETED → ACTIVE) ───────────
  async bulkReenroll(userId: string, sequenceId: string, dto: BulkContactActionDto) {
    const seqOid = new Types.ObjectId(sequenceId);
    const uid    = new Types.ObjectId(userId);
    const seq    = await Sequence.findOne({ _id: seqOid, user_id: uid })
      .select('sending_window').lean();
    if (!seq) throw AppError.notFound('Sequence not found');

    const eligibleStatuses = [
      ContactEnrollmentStatus.FAILED,
      ContactEnrollmentStatus.BOUNCED,
      ContactEnrollmentStatus.COMPLETED,
      ContactEnrollmentStatus.REPLIED,
    ];
    const match = dto.contactIds?.length
      ? { _id: { $in: dto.contactIds.map((id: string) => new Types.ObjectId(id)) }, sequence_id: seqOid, user_id: uid }
      : { sequence_id: seqOid, user_id: uid, status: { $in: eligibleStatuses } };

    const nextSendAt = calculateNextValidSlot(new Date(), seq.sending_window, undefined);
    const result = await SequenceContact.updateMany(match, {
      $set: { status: ContactEnrollmentStatus.ACTIVE, next_send_at: nextSendAt, current_step_index: 0, sending_locked: false }
    });
    const reenrolled = result.modifiedCount;
    await AuditLog.create({
      user_id: uid, sequence_id: seqOid,
      action_type: 'bulk_reenroll', browser_timezone: 'UTC',
      affected_contacts_count: reenrolled,
      details: { contactIds: dto.contactIds, nextSendAt }
    });
    return { reenrolled };
  }

  // ── Export contacts as flat rows for CSV ──────────────────────────
  async exportContacts(userId: string, sequenceId: string, query: { status?: string } = {}) {
    const seqOid = new Types.ObjectId(sequenceId);
    const uid    = new Types.ObjectId(userId);
    const match: Record<string, unknown> = { sequence_id: seqOid, user_id: uid };
    if (query.status) match.status = query.status;

    const contacts = await SequenceContact.find(match)
      .select('contact_email contact_first_name contact_last_name contact_company status current_step_index enrolled_at completed_at')
      .lean();

    return contacts.map(c => ({
      contact_email:      c.contact_email,
      contact_first_name: c.contact_first_name,
      contact_last_name:  c.contact_last_name,
      contact_company:    c.contact_company,
      status:             c.status,
      current_step_index: c.current_step_index,
      enrolled_at:        c.enrolled_at,
      last_activity_at:   c.completed_at,
    }));
  }
}

export const enrollmentService = new EnrollmentService();
export { computeNextSendAt };

