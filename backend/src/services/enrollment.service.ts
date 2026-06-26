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
            'enrollment'
          ).catch(err => {
            logger.error('Failed to enqueue job for newly enrolled contact', { contactId: contactDoc._id, err: err.message });
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
        'resume'
      ).catch(err => logger.error('Failed to enqueue job on resume', { contactId, err: err.message }));
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
        'bulk_resume'
      ).catch(err => logger.error('Failed to enqueue job on bulk resume', { contactId: c._id, err: err.message }));
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
}

export const enrollmentService = new EnrollmentService();
export { computeNextSendAt };
