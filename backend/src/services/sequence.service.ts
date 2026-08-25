import { Types, FilterQuery } from 'mongoose';
import { Sequence, ISequence, SequenceStatus } from '../models/Sequence';
import { SequenceStep, ISequenceStep, StepType } from '../models/SequenceStep';
import { SequenceContact } from '../models/SequenceContact';
import { SendingLog } from '../models/SendingLog';
import { calculateNextValidSlot } from '../utils/scheduling';
import { EmailConnection, ConnectionStatus } from '../models/EmailConnection';
import { getSchedulerQueue } from '../queues/schedulerQueue';
import { Template } from '../models/Template';
import { AppError } from '../utils/AppError';
import logger from '../config/logger';
import {
  CreateSequenceDto,
  UpdateSequenceDto,
  TransitionStatusDto,
  ListSequenceQueryDto,
  CreateStepDto,
  UpdateStepDto,
  ReorderStepsDto,
} from '../validators/sequence.validator';
import { renderEmail } from '../utils/templateRenderer';

// ─── State machine ─────────────────────────────────────────────────
/**
 * Allowed transitions:
 *   draft     → active, archived
 *   active    → paused, archived
 *   paused    → active, archived
 *   completed → archived
 *   archived  → (none)
 */
const ALLOWED_TRANSITIONS: Record<SequenceStatus, SequenceStatus[]> = {
  [SequenceStatus.DRAFT]:     [SequenceStatus.ACTIVE, SequenceStatus.ARCHIVED],
  [SequenceStatus.ACTIVE]:    [SequenceStatus.PAUSED, SequenceStatus.ARCHIVED],
  [SequenceStatus.PAUSED]:    [SequenceStatus.ACTIVE, SequenceStatus.ARCHIVED],
  [SequenceStatus.COMPLETED]: [SequenceStatus.ARCHIVED],
  [SequenceStatus.ARCHIVED]:  [],
};

// ─── Helpers ───────────────────────────────────────────────────────
function assertEditableStatus(sequence: ISequence, action = 'edit'): void {
  if (sequence.status === SequenceStatus.ACTIVE) {
    throw AppError.badRequest(
      `Cannot ${action} an active sequence. Pause it first.`
    );
  }
  if (sequence.status === SequenceStatus.ARCHIVED) {
    throw AppError.badRequest(`Cannot ${action} an archived sequence.`);
  }
  if (sequence.status === SequenceStatus.COMPLETED) {
    throw AppError.badRequest(`Cannot ${action} a completed sequence.`);
  }
}

async function assertOwned(
  userId: string,
  sequenceId: string
): Promise<ISequence> {
  const seq = await Sequence.findOne({ _id: sequenceId, user_id: userId });
  if (!seq) throw AppError.notFound('Sequence');
  return seq;
}

async function assertEmailConnectionValid(
  userId: string,
  connectionId: string
): Promise<void> {
  const conn = await EmailConnection.findOne({
    _id: connectionId,
    user_id: userId,
    status: ConnectionStatus.ACTIVE,
  });
  if (!conn) {
    throw AppError.badRequest(
      `Email connection "${connectionId}" not found or is not active. ` +
      `Please verify the connection before using it.`
    );
  }
}

async function assertTemplateValid(
  userId: string,
  templateId: string
): Promise<void> {
  const tmpl = await Template.findOne({
    _id: templateId,
    user_id: userId,
    is_archived: false,
  });
  if (!tmpl) {
    throw AppError.badRequest(
      `Template "${templateId}" not found or is archived.`
    );
  }
}

// ─── Service ───────────────────────────────────────────────────────
export class SequenceService {

  // ════════════════════════════════════════════════════════════════
  //  SEQUENCE CRUD
  // ════════════════════════════════════════════════════════════════

  async create(userId: string, dto: CreateSequenceDto): Promise<ISequence> {
    const existingName = await Sequence.findOne({
      user_id: new Types.ObjectId(userId),
      name: { $regex: new RegExp(`^${dto.name.trim()}$`, 'i') }
    });
    if (existingName) {
      throw AppError.badRequest('A sequence with this name already exists.');
    }

    // Validate email connection exists and is active if provided
    if (dto.email_connection_id) {
      await assertEmailConnectionValid(userId, dto.email_connection_id);
    }

    const seq = await Sequence.create({
      user_id:             new Types.ObjectId(userId),
      email_connection_id: dto.email_connection_id ? new Types.ObjectId(dto.email_connection_id) : undefined,
      name:                dto.name,
      description:         dto.description,
      launch_date:         dto.launch_date,
      daily_sending_limit: dto.daily_sending_limit,
      reserved_limit_phase1: dto.reserved_limit_phase1,
      warmup_percentage:   dto.warmup_percentage,
      sending_window:      dto.sending_window ?? {},
      stop_on_reply:       dto.stop_on_reply,
      stop_on_bounce:      dto.stop_on_bounce,
      stop_on_click:       dto.stop_on_click,
      track_opens:         dto.track_opens,
      track_clicks:        dto.track_clicks,
      status:              SequenceStatus.PAUSED,
    });

    logger.info('Sequence created', { sequenceId: seq._id, userId });
    return seq;
  }

  async findAll(
    userId: string,
    query: ListSequenceQueryDto
  ): Promise<{ sequences: (ISequence & { pending_count: number; last_activity_at: Date | null })[]; total: number; page: number; totalPages: number }> {
    const filter: FilterQuery<ISequence> = {
      user_id:     userId,
      is_archived: query.status === SequenceStatus.ARCHIVED ? true : { $ne: true },
    };

    if (query.status) filter.status = query.status;
    if (query.search) {
      filter.$text = { $search: query.search };
    }

    const sortField  = query.sort_by;
    const sortOrder  = query.sort_order === 'asc' ? 1 : -1;
    const skip       = (query.page - 1) * query.limit;

    const [sequences, total] = await Promise.all([
      Sequence.find(filter)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(query.limit)
        .lean<ISequence[]>(),
      Sequence.countDocuments(filter),
    ]);

    // ── Enrich each sequence with pending_count and last_activity_at ─────────
    // Two bulk aggregations (not N+1) using existing indexes:
    //   SequenceContact: { sequence_id: 1, status: 1, next_send_at: 1 }  (scheduler index)
    //   SendingLog:      { sequence_id: 1, status: 1, sent_at: -1 }       (analytics index)

    const seqIds = sequences.map((s) => (s as any)._id);

    if (seqIds.length > 0) {
      const now = new Date();

      const [pendingCounts, activityStats] = await Promise.all([
        // pending_count: contacts actively enrolled and waiting for their next scheduled send
        SequenceContact.aggregate<{ _id: Types.ObjectId; count: number }>([
          {
            $match: {
              sequence_id: { $in: seqIds },
              status: 'active',
              $or: [
                { next_send_at: { $gt: now } },
                { next_send_at: null },
              ],
            },
          },
          { $group: { _id: '$sequence_id', count: { $sum: 1 } } },
        ]),

        // last_activity_at: most recent successful email send for each sequence
        SendingLog.aggregate<{ _id: Types.ObjectId; last_sent_at: Date }>([
          {
            $match: {
              sequence_id: { $in: seqIds },
              status: 'sent',
              sent_at: { $ne: null },
            },
          },
          { $group: { _id: '$sequence_id', last_sent_at: { $max: '$sent_at' } } },
        ]),
      ]);

      // Build O(1) lookup maps
      const pendingMap = new Map<string, number>();
      for (const row of pendingCounts) {
        pendingMap.set(row._id.toString(), row.count);
      }

      const activityMap = new Map<string, Date>();
      for (const row of activityStats) {
        activityMap.set(row._id.toString(), row.last_sent_at);
      }

      // Merge into sequence objects
      const enriched = sequences.map((seq) => {
        const id = (seq as any)._id.toString();
        return Object.assign(seq, {
          pending_count:    pendingMap.get(id) ?? 0,
          last_activity_at: activityMap.get(id) ?? null,
        });
      });

      return {
        sequences: enriched as (ISequence & { pending_count: number; last_activity_at: Date | null })[],
        total,
        page: query.page,
        totalPages: Math.ceil(total / query.limit),
      };
    }

    // No sequences — return empty with defaults
    return {
      sequences: sequences.map((seq) =>
        Object.assign(seq, { pending_count: 0, last_activity_at: null })
      ) as (ISequence & { pending_count: number; last_activity_at: Date | null })[],
      total,
      page: query.page,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async findById(userId: string, sequenceId: string): Promise<ISequence> {
    return assertOwned(userId, sequenceId);
  }

  async findWithSteps(
    userId: string,
    sequenceId: string
  ): Promise<{ sequence: ISequence; steps: ISequenceStep[] }> {
    const sequence = await assertOwned(userId, sequenceId);
    const steps    = await SequenceStep.find({ sequence_id: sequenceId })
      .sort({ step_index: 1 });

    return { sequence, steps };
  }

  async update(
    userId: string,
    sequenceId: string,
    dto: UpdateSequenceDto
  ): Promise<ISequence> {
    const seq = await assertOwned(userId, sequenceId);
    assertEditableStatus(seq, 'update');

    if (dto.email_connection_id) {
      await assertEmailConnectionValid(userId, dto.email_connection_id);
      seq.email_connection_id = new Types.ObjectId(dto.email_connection_id);
    }

    if (dto.name) {
      const existingName = await Sequence.findOne({
        user_id: new Types.ObjectId(userId),
        name: { $regex: new RegExp(`^${dto.name.trim()}$`, 'i') },
        _id: { $ne: seq._id }
      });
      if (existingName) {
        throw AppError.badRequest('A sequence with this name already exists.');
      }
      seq.name = dto.name;
    }
    if (dto.description !== undefined) seq.description = dto.description ?? undefined;
    if (dto.sending_window)            Object.assign(seq.sending_window, dto.sending_window);
    if (dto.stop_on_reply  !== undefined) seq.stop_on_reply  = dto.stop_on_reply;
    if (dto.stop_on_bounce !== undefined) seq.stop_on_bounce = dto.stop_on_bounce;
    if (dto.stop_on_click  !== undefined) seq.stop_on_click  = dto.stop_on_click;
    if (dto.track_opens    !== undefined) seq.track_opens    = dto.track_opens;
    if (dto.track_clicks   !== undefined) seq.track_clicks   = dto.track_clicks;

    await seq.save();
    logger.info('Sequence updated', { sequenceId, userId });
    return seq;
  }

  async delete(userId: string, sequenceId: string): Promise<void> {
    const seq = await assertOwned(userId, sequenceId);

    if (seq.status === SequenceStatus.ACTIVE) {
      throw AppError.badRequest(
        'Cannot delete an active sequence. Pause or archive it first.'
      );
    }

    // Hard delete sequence + all its steps + all its contacts
    await Promise.all([
      Sequence.deleteOne({ _id: sequenceId }),
      SequenceStep.deleteMany({ sequence_id: sequenceId }),
      SequenceContact.deleteMany({ sequence_id: sequenceId }),
    ]);

    logger.info('Sequence hard-deleted', { sequenceId, userId });
  }

  // ════════════════════════════════════════════════════════════════
  //  STATE MACHINE
  // ════════════════════════════════════════════════════════════════

  async transition(
    userId: string,
    sequenceId: string,
    dto: TransitionStatusDto
  ): Promise<ISequence> {
    const seq        = await assertOwned(userId, sequenceId);
    const from       = seq.status;
    const to         = dto.status;

    // Idempotent: if already in target state, handle gracefully
    if (from === to) {
      // For active→active re-launch: still schedule contacts and fire an immediate tick
      // so that any contacts without next_send_at get picked up immediately.
      if (to === SequenceStatus.ACTIVE) {
        logger.info('[ACTIVATION] active→active re-launch: re-scheduling contacts and firing immediate tick', { sequenceId });
        const isImmediate = dto.send_immediately === true;
        const now = new Date();
        const adjustedNextSendAt = isImmediate
          ? now // Use exactly 'now' so scheduler's $lte:now query matches it immediately
          : calculateNextValidSlot(now, seq.sending_window as any, seq.launch_date);

        // [FIX] Always update ALL active contacts on re-launch.
        // If contacts were enrolled while the sending window was already past,
        // their next_send_at points to a future slot that is valid but stale
        // (computed at enrollment time, not re-launch time). We must recalculate
        // from now so the scheduler picks them up at the correct new slot.
        const contactFilter = { sequence_id: sequenceId, status: 'active' as const };

        const updated = await SequenceContact.updateMany(contactFilter, {
          $set: { next_send_at: adjustedNextSendAt },
        });
        logger.info('[ACTIVATION] Re-scheduled contacts for active→active', {
          sequenceId, matchedCount: updated.matchedCount, isImmediate, adjustedNextSendAt,
        });

        const liveSchedulerQueue = getSchedulerQueue();
        if (liveSchedulerQueue) {
          liveSchedulerQueue.add(
            'scheduler:tick:immediate',
            { reason: 'sequence_relaunch', sequenceId: sequenceId.toString() },
            { removeOnComplete: 5, removeOnFail: 5 }
          ).then(() => {
            logger.info('[ACTIVATION] Enqueued immediate tick for re-launched sequence', { sequenceId });
          }).catch((redisErr: any) => {
            logger.warn('[ACTIVATION] Could not enqueue immediate tick (Redis unavailable) — scheduler will pick up on next periodic tick', {
              sequenceId, error: redisErr.message,
            });
          });
        }
      } else {
        logger.info('Sequence transition skipped (already in target state)', { sequenceId, from, to });
      }
      return seq;
    }

    const allowed    = ALLOWED_TRANSITIONS[from];

    if (!allowed.includes(to)) {
      throw AppError.badRequest(
        `Cannot transition from "${from}" to "${to}". ` +
        `Allowed: [${allowed.join(', ') || 'none'}]`
      );
    }

    // Guard: must have at least one email step to activate, and all must be valid
    // Guard: use getSequenceIntegrity for comprehensive check
    if (to === SequenceStatus.ACTIVE) {
      const integrity = await this.getSequenceIntegrity(userId, sequenceId);
      if (!integrity.is_valid) {
        // Collect a single readable error string of the first few issues
        const firstIssue = integrity.issues[0];
        throw AppError.badRequest(
          `Cannot activate sequence due to integrity issues: Step ${firstIssue.step_index + 1} has ${firstIssue.issues.join(', ')}`
        );
      }

      // Validate email connection is still active if a default is set
      if (seq.email_connection_id) {
        await assertEmailConnectionValid(
          userId,
          seq.email_connection_id.toString()
        );
      }
    }

    seq.status = to;
    if (to === SequenceStatus.ARCHIVED) seq.is_archived = true;

    await seq.save();

    // If activating, set next_send_at on active contacts so the scheduler picks them up.
    if (to === SequenceStatus.ACTIVE && from !== SequenceStatus.ACTIVE) {
      const now = new Date();

      // ── Activation-time scheduling branch ─────────────────────────────
      //
      // send_immediately = true (passed by caller, NOT persisted):
      //   • next_send_at = now + 1 s  — bypasses window / weekday math entirely
      //   • Filter: ALL active contacts — contacts enrolled outside a valid window
      //     already have next_send_at = future slot (e.g. Saturday → Monday),
      //     so the narrow $lte:now filter would match 0 contacts. We must update all.
      //
      // send_immediately = false (default):
      //   • next_send_at = calculateNextValidSlot(now, window, launch_date)
      //   • Filter: only contacts that are past-due or have no send time yet
      //     (preserves the correct future next_send_at for newly enrolled contacts)
      //
      // After the first send fires, advanceContact() always uses calculateNextValidSlot
      // for all subsequent steps — window restrictions are fully restored.
      const isImmediate = dto.send_immediately === true;

      const adjustedNextSendAt = isImmediate 
        ? now // Use exactly 'now' so it matches next_send_at <= now
        : calculateNextValidSlot(now, seq.sending_window as any, seq.launch_date);

      // Scheduler verification:
      //   runScheduler() queries: { status:'active', next_send_at:{ $lte: now }, sending_locked: false }
      //   With isImmediate, adjustedNextSendAt = now ≤ now → scheduler sweep catches it.
      //   The immediate tick enqueued below ensures the sweep runs within seconds of activation.

      logger.info('[ACTIVATION] Scheduling mode determined', {
        sequenceId:          sequenceId.toString(),
        isImmediate,
        adjustedNextSendAt:  adjustedNextSendAt.toISOString(),
        serverTimeUtc:       now.toISOString(),
        contactBecomesImmediatelyDue: isImmediate,
      });

      // [FIX] Always update ALL active contacts on activation — regardless of whether
      // send_immediately is true or false.
      //
      // REASON: Contacts are enrolled before the sequence is activated. During enrollment
      // the sending window may already be closed for today, so enrollment.service.ts
      // correctly sets next_send_at to the NEXT available window slot (e.g. tomorrow 15:30).
      // When the user then activates with send_immediately=false, the old narrow filter
      // ({ next_send_at: { $lte: now } }) matched 0 contacts (they were all in the future)
      // and left them stuck until the pre-computed slot arrived — which could be days away.
      //
      // The fix: always overwrite next_send_at for ALL active contacts using
      // adjustedNextSendAt (which is either `now` for immediate, or the correctly
      // recalculated next window slot computed at activation time). This is safe because:
      //   - For isImmediate=true:  adjustedNextSendAt = now  → scheduler picks up instantly
      //   - For isImmediate=false: adjustedNextSendAt = calculateNextValidSlot(now, ...)  
      //     → may be the same future slot OR a new slot if the window changed
      const contactFilter = { sequence_id: sequenceId, status: 'active' as const };
      
      const allActiveContacts = await SequenceContact.find({
        sequence_id: sequenceId,
        status: 'active',
      }).select('_id status current_step_index next_send_at').lean();

      const activeCountBefore = allActiveContacts.length;

      // Sample before states
      const sampleBefore = allActiveContacts.slice(0, 5).map(c => ({
        contactId: c._id.toString(),
        status: c.status,
        current_step_index: c.current_step_index,
        next_send_at: c.next_send_at ? c.next_send_at.toISOString() : null
      }));

      await SequenceContact.updateMany(contactFilter, {
        $set: { next_send_at: adjustedNextSendAt },
      });

      const allActiveContactsAfter = await SequenceContact.find({
        sequence_id: sequenceId,
        status: 'active',
      }).select('_id status current_step_index next_send_at').lean();

      const activeCountAfter = allActiveContactsAfter.length;
      let countDueImmediately = 0;
      let countFuture = 0;

      const sampleAfter = allActiveContactsAfter.slice(0, 5).map(c => {
        const isDue = c.next_send_at && c.next_send_at <= now;
        if (isDue) countDueImmediately++;
        else countFuture++;
        
        let reason = '';
        if (!isDue) {
           reason = (c.next_send_at && c.next_send_at > now) ? 'future date computed' : 'missing next_send_at';
        }

        return {
          contactId: c._id.toString(),
          status: c.status,
          current_step_index: c.current_step_index,
          next_send_at: c.next_send_at ? c.next_send_at.toISOString() : null,
          is_due_now: isDue,
          reason_if_not_due: reason
        };
      });
      
      // Calculate remaining due/future for logging accurately
      for (let i = 5; i < allActiveContactsAfter.length; i++) {
        const c = allActiveContactsAfter[i];
        if (c.next_send_at && c.next_send_at <= now) countDueImmediately++;
        else countFuture++;
      }

      logger.info('SEQUENCE ACTIVATION LIFECYCLE - DIAGNOSTICS', {
        sequenceId: sequenceId.toString(),
        isImmediate,
        previousStatus: from,
        newStatus: to,
        activationTimestamp: now.toISOString(),
        activeContactCountBefore: activeCountBefore,
        activeContactCountAfter: activeCountAfter,
        contactsDueImmediately: countDueImmediately,
        contactsScheduledForFuture: countFuture,
        sampleContactsBefore: sampleBefore,
        sampleContactsAfter: sampleAfter
      });

      // Enqueue immediate sequence-scoped tick so Launch Campaign sends without requiring restart
      const liveSchedulerQueue = getSchedulerQueue();
      if (liveSchedulerQueue) {
        // [FIX] Do not await this. If Redis is unavailable, BullMQ's offline queue
        // will cause await to hang indefinitely. This is a background task.
        liveSchedulerQueue.add(
          'scheduler:tick:immediate', 
          { reason: 'sequence_activation', sequenceId: sequenceId.toString() }, 
          { removeOnComplete: 5, removeOnFail: 5 }
        ).then(() => {
          logger.info('SEQUENCE ACTIVATION: Enqueued immediate sequence-scoped scheduler tick', { sequenceId: sequenceId.toString() });
        }).catch((redisErr: any) => {
          logger.warn('SEQUENCE ACTIVATION: Could not enqueue immediate tick (Redis unavailable) — scheduler will pick up on next periodic tick', {
            sequenceId, error: redisErr.message,
          });
        });
      } else {
        logger.warn('SEQUENCE ACTIVATION: Scheduler queue not initialized — immediate tick skipped. Waiting for periodic tick.', { sequenceId: sequenceId.toString() });
      }
    }

    logger.info('Sequence status transitioned', {
      sequenceId,
      userId,
      from,
      to,
    });

    return seq;
  }

  // ════════════════════════════════════════════════════════════════
  //  STEP MANAGEMENT
  // ════════════════════════════════════════════════════════════════

  async getSteps(
    userId: string,
    sequenceId: string
  ): Promise<ISequenceStep[]> {
    await assertOwned(userId, sequenceId);
    return SequenceStep.find({ sequence_id: sequenceId }).sort({ step_index: 1 });
  }

  async addStep(
    userId: string,
    sequenceId: string,
    dto: CreateStepDto
  ): Promise<ISequenceStep> {
    const seq = await assertOwned(userId, sequenceId);
    assertEditableStatus(seq, 'add steps to');

    // Validate referenced resources for email steps
    if (dto.type === StepType.EMAIL) {
      if (dto.template_id) {
        await assertTemplateValid(userId, dto.template_id);
      }
      if ((dto as any).email_connection_id) {
        await assertEmailConnectionValid(userId, (dto as any).email_connection_id);
      } else if (!seq.email_connection_id) {
        throw AppError.badRequest('An email_connection_id is required for this step because the sequence has no default sender.');
      }
    }

    // Assign next step_index
    const maxStep = await SequenceStep.findOne({ sequence_id: sequenceId })
      .sort({ step_index: -1 })
      .select('step_index')
      .lean();

    const nextIndex = maxStep ? maxStep.step_index + 1 : 0;

    const stepData: Record<string, unknown> = {
      sequence_id:  new Types.ObjectId(sequenceId),
      user_id:      new Types.ObjectId(userId),
      step_index:   nextIndex,
      type:         dto.type,
      delay_days:   (dto as any).delay_days  ?? 0,
      delay_hours:  (dto as any).delay_hours ?? 0,
      is_active:    true,
    };

    if (dto.type === StepType.EMAIL) {
      stepData.template_id          = dto.template_id ? new Types.ObjectId(dto.template_id) : undefined;
      stepData.email_connection_id  = (dto as any).email_connection_id
        ? new Types.ObjectId((dto as any).email_connection_id)
        : undefined;
      stepData.subject_override     = (dto as any).subject_override;
      stepData.body_html_override   = (dto as any).body_html_override;
      stepData.body_text_override   = (dto as any).body_text_override;
      stepData.track_opens          = (dto as any).track_opens;
      stepData.track_clicks         = (dto as any).track_clicks;
    }

    if (dto.type === StepType.CONDITION) {
      stepData.condition = (dto as any).condition;
    }

    logger.info('DEBUG: addStep payload from frontend', {
      receivedDto: dto,
      mappedStepData: stepData
    });

    const step = await SequenceStep.create(stepData);

    // Update denormalized step_count on Sequence
    await Sequence.updateOne(
      { _id: sequenceId },
      { $inc: { step_count: 1 } }
    );

    logger.info('Step added to sequence', {
      sequenceId,
      stepId: step._id,
      type: dto.type,
      stepIndex: nextIndex,
    });

    return step;
  }

  async updateStep(
    userId: string,
    sequenceId: string,
    stepId: string,
    dto: UpdateStepDto
  ): Promise<ISequenceStep> {
    const seq  = await assertOwned(userId, sequenceId);
    assertEditableStatus(seq, 'update steps in');

    const step = await SequenceStep.findOne({
      _id:         stepId,
      sequence_id: sequenceId,
    });
    if (!step) throw AppError.notFound('Sequence step');

    // Cross-type changes are not allowed — must delete and re-add
    if ((dto as any).type && (dto as any).type !== step.type) {
      throw AppError.badRequest(
        `Cannot change step type from "${step.type}" to "${(dto as any).type}". ` +
        `Delete this step and create a new one.`
      );
    }

    if (dto.type === StepType.EMAIL) {
      const emailDto = dto as Partial<typeof dto & {
        template_id: string;
        email_connection_id?: string;
        subject_override?: string;
        body_html_override?: string;
        body_text_override?: string;
        track_opens?: boolean;
        track_clicks?: boolean;
      }>;

      if (emailDto.template_id) {
        await assertTemplateValid(userId, emailDto.template_id);
        step.template_id = new Types.ObjectId(emailDto.template_id);
      }
      if (emailDto.email_connection_id) {
        await assertEmailConnectionValid(userId, emailDto.email_connection_id);
        step.email_connection_id = new Types.ObjectId(emailDto.email_connection_id);
      } else if (!step.email_connection_id && !seq.email_connection_id) {
        // If the user tries to update to remove the connection ID or if it was already missing,
        // and the sequence has no default, throw an error.
        throw AppError.badRequest('An email_connection_id is required because the sequence has no default sender.');
      }
      if (emailDto.subject_override !== undefined)    step.subject_override   = emailDto.subject_override;
      if (emailDto.body_html_override !== undefined)  step.body_html_override = emailDto.body_html_override;
      if (emailDto.body_text_override !== undefined)  step.body_text_override = emailDto.body_text_override;
      if (emailDto.track_opens  !== undefined)        step.track_opens        = emailDto.track_opens;
      if (emailDto.track_clicks !== undefined)        step.track_clicks       = emailDto.track_clicks;
    }

    if ((dto as any).delay_days  !== undefined) step.delay_days  = (dto as any).delay_days;
    if ((dto as any).delay_hours !== undefined) step.delay_hours = (dto as any).delay_hours;
    if ((dto as any).condition   !== undefined) step.condition   = (dto as any).condition;

    logger.info('DEBUG: updateStep payload from frontend', {
      receivedDto: dto,
      stepBeforeSave: step.toObject()
    });

    await step.save();

    logger.info('Sequence step updated', { sequenceId, stepId, userId });
    return step;
  }

  async deleteStep(
    userId: string,
    sequenceId: string,
    stepId: string
  ): Promise<void> {
    const seq  = await assertOwned(userId, sequenceId);
    assertEditableStatus(seq, 'delete steps from');

    const step = await SequenceStep.findOne({
      _id:         stepId,
      sequence_id: sequenceId,
    });
    if (!step) throw AppError.notFound('Sequence step');

    const deletedIndex = step.step_index;
    await step.deleteOne();

    // Compact step_index values for steps after the deleted one
    await SequenceStep.updateMany(
      { sequence_id: sequenceId, step_index: { $gt: deletedIndex } },
      { $inc: { step_index: -1 } }
    );

    // Decrement denormalized step_count
    await Sequence.updateOne(
      { _id: sequenceId },
      { $inc: { step_count: -1 } }
    );

    logger.info('Sequence step deleted', {
      sequenceId,
      stepId,
      userId,
      deletedIndex,
    });
  }

  async reorderSteps(
    userId: string,
    sequenceId: string,
    dto: ReorderStepsDto
  ): Promise<ISequenceStep[]> {
    const seq = await assertOwned(userId, sequenceId);
    assertEditableStatus(seq, 'reorder steps in');

    // Fetch all steps — validate all provided IDs belong to this sequence
    const allSteps = await SequenceStep.find({ sequence_id: sequenceId });
    const stepMap  = new Map(allSteps.map((s) => [s._id.toString(), s]));

    for (const id of dto.step_ids) {
      if (!stepMap.has(id)) {
        throw AppError.badRequest(
          `Step "${id}" does not belong to sequence "${sequenceId}"`
        );
      }
    }

    if (dto.step_ids.length !== allSteps.length) {
      throw AppError.badRequest(
        `Reorder must include all ${allSteps.length} step IDs. ` +
        `Provided: ${dto.step_ids.length}`
      );
    }

    // Apply new indexes in bulk
    const bulkOps = dto.step_ids.map((id, newIndex) => ({
      updateOne: {
        filter: { _id: new Types.ObjectId(id) },
        update: { $set: { step_index: newIndex } },
      },
    }));

    await SequenceStep.bulkWrite(bulkOps);

    logger.info('Sequence steps reordered', { sequenceId, userId });

    // Return updated steps in new order
    return SequenceStep.find({ sequence_id: sequenceId }).sort({ step_index: 1 });
  }

  async toggleStepActive(
    userId: string,
    sequenceId: string,
    stepId: string
  ): Promise<ISequenceStep> {
    const seq  = await assertOwned(userId, sequenceId);
    assertEditableStatus(seq, 'toggle steps in');

    const step = await SequenceStep.findOne({
      _id:         stepId,
      sequence_id: sequenceId,
    });
    if (!step) throw AppError.notFound('Sequence step');

    step.is_active = !step.is_active;
    await step.save();

    logger.info(`Step ${step.is_active ? 'enabled' : 'disabled'}`, {
      sequenceId,
      stepId,
    });

    return step;
  }

  // ════════════════════════════════════════════════════════════════
  //  ACTIVATION SAFETY
  // ════════════════════════════════════════════════════════════════

  async getSequenceIntegrity(userId: string, sequenceId: string) {
    const seq = await assertOwned(userId, sequenceId);
    
    const steps = await SequenceStep.find({ sequence_id: sequenceId }).sort({ step_index: 1 }).lean();
    
    // Fetch related entities to ensure they exist
    const templates = await Template.find({ user_id: userId }).select('_id is_archived').lean();
    const activeTemplates = new Set(templates.filter(t => !t.is_archived).map(t => t._id.toString()));
    
    const connections = await EmailConnection.find({ user_id: userId }).select('_id status').lean();
    const activeConnections = new Set(connections.filter(c => c.status === ConnectionStatus.ACTIVE).map(c => c._id.toString()));

    const issues: { step_id: string, step_index: number, issues: string[] }[] = [];

    // Verify ordering
    let expectedIndex = 0;

    for (const step of steps) {
      const stepIssues: string[] = [];

      if (step.step_index !== expectedIndex) {
        stepIssues.push('invalid_step_ordering');
      }
      expectedIndex++;

      if (step.type === StepType.EMAIL) {
        if (!step.template_id && !step.subject_override && !step.body_html_override) {
          stepIssues.push('missing_template_id');
        } else if (step.template_id && !activeTemplates.has(step.template_id.toString())) {
          stepIssues.push('missing_template_reference'); // Not found or archived
        }

        const connId = (step as any).email_connection_id || seq.email_connection_id;
        if (!connId) {
          stepIssues.push('missing_email_connection_id');
        } else if (!activeConnections.has(connId.toString())) {
          stepIssues.push('missing_sender_accounts');
        }
      }

      if (stepIssues.length > 0) {
        issues.push({
          step_id: step._id.toString(),
          step_index: step.step_index,
          issues: stepIssues
        });
      }
    }

    if (steps.filter(s => s.type === StepType.EMAIL && s.is_active).length === 0) {
      issues.push({
        step_id: 'global',
        step_index: -1,
        issues: ['no_active_email_steps']
      });
    }

    return {
      is_valid: issues.length === 0,
      issues
    };
  }

  async preActivationCheck(userId: string, sequenceId: string) {
    const seq = await assertOwned(userId, sequenceId);
    
    const errors: string[] = [];
    const warnings: string[] = [];
    let is_first_campaign = false;
    let senderEmail = 'Unknown';
    let firstSubject = 'N/A';

    // 1. Fetch related data
    const steps = await SequenceStep.find({ sequence_id: sequenceId, is_active: true }).sort({ step_index: 1 }).lean();
    
    // Launchable statuses: contacts that can be processed (or resumed) after activation
    const launchableStatuses = ['active', 'paused'];
    const launchableContactsCount = await SequenceContact.countDocuments({ 
      sequence_id: sequenceId, 
      status: { $in: launchableStatuses } 
    });

    // 2. Validate Sequence
    if (seq.status === SequenceStatus.ARCHIVED) {
      errors.push('Sequence is archived and cannot be activated.');
    }
    
    // Check integrity
    const integrity = await this.getSequenceIntegrity(userId, sequenceId);
    if (!integrity.is_valid) {
      for (const issue of integrity.issues) {
        if (issue.step_id === 'global' && issue.issues.includes('no_active_email_steps')) {
          errors.push('Sequence contains no active email steps.');
        } else {
          for (const type of issue.issues) {
            if (type === 'missing_template_id') errors.push(`Step ${issue.step_index + 1} is missing a template.`);
            if (type === 'missing_email_connection_id') errors.push(`Step ${issue.step_index + 1} is missing a sender account.`);
            if (type === 'missing_template_reference') errors.push(`Step ${issue.step_index + 1} refers to an invalid or archived template.`);
            if (type === 'missing_sender_accounts') errors.push(`Step ${issue.step_index + 1} refers to an invalid or inactive sender account.`);
            if (type === 'invalid_step_ordering') errors.push(`Step ${issue.step_index + 1} has an invalid ordering index.`);
          }
        }
      }
    }

    // 3. Validate Contacts
    if (launchableContactsCount === 0) {
      errors.push('Sequence has no launchable enrolled contacts.');
    } else if (launchableContactsCount >= 50) {
      warnings.push(`This sequence will email ${launchableContactsCount} recipients.`);
    }

    const emailSteps = steps.filter(s => s.type === StepType.EMAIL);

    // 4. Sender Summary
    for (const emailStep of emailSteps) {
      const connId = (emailStep as any).email_connection_id || seq.email_connection_id;
      if (connId) {
        const conn = await EmailConnection.findOne({ _id: connId, user_id: userId });
        if (conn && conn.status === ConnectionStatus.ACTIVE) {
          // Track details for the summary using the first email step's sender
          if (emailStep === emailSteps[0]) {
            senderEmail = conn.from_email;
            if (conn.total_sent === 0) {
              is_first_campaign = true;
            }
          }
        }
      }
    }

    const firstEmailStep = emailSteps[0];
    if (firstEmailStep) {

      if (!firstEmailStep.template_id) {
        errors.push('First email step is missing a template.');
      } else {
        const template = await Template.findOne({ _id: firstEmailStep.template_id, user_id: userId, is_archived: false });
        if (!template) {
          errors.push('Template for the first email step is missing or archived.');
        } else {
          firstSubject = firstEmailStep.subject_override || template.subject;
          const bodyHtml = firstEmailStep.body_html_override || template.body_html;
          
          // Warning: Test Subject
          const subjLower = firstSubject.toLowerCase().trim();
          if (subjLower.length < 5 || ['test', 'testing', 'hi', 'hello'].includes(subjLower)) {
            warnings.push('Subject appears to be test content.');
          }

          // Warning: Test Body
          if (/test|testing|hello world|sample email/i.test(bodyHtml)) {
            warnings.push('Template appears to contain test content.');
          }

          // Warning: Missing Personalization
          if (!/\{\{.*\}\}/.test(bodyHtml)) {
            warnings.push('Template contains no personalization fields.');
          }

          // Phase 2: Dry Run Template Validation
          const firstContact = await SequenceContact.findOne({ 
            sequence_id: sequenceId, 
            status: { $in: launchableStatuses } 
          }).lean();
          if (firstContact) {
            const rendered = renderEmail({
              subject: firstSubject,
              body_html: bodyHtml
            }, {
              first_name: firstContact.contact_first_name,
              last_name: firstContact.contact_last_name,
              company: firstContact.contact_company,
              email: firstContact.contact_email,
              custom_variables: firstContact.custom_variables || {}
            }, {
              sequenceContactId: firstContact._id.toString(),
              sendingLogId:      'dry-run',
              messageId:         'dry-run',
              trackOpens:        false,
              trackClicks:       false,
              unsubscribeUrl:    '#', // placeholder — not used in pre-activation check
            });

            // Check for unresolved square brackets [industry], etc.
            if (/\[\w+\]/.test(rendered.body_html) || /\[\w+\]/.test(rendered.subject)) {
              warnings.push('Template contains unresolved merge tags.');
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
      is_first_campaign,
      summary: {
        contacts: launchableContactsCount,
        steps: steps.length,
        sender: senderEmail,
        first_subject: firstSubject,
        estimated_sends_today: Math.min(launchableContactsCount, seq.daily_sending_limit || launchableContactsCount)
      }
    };
  }
}

export const sequenceService = new SequenceService();
