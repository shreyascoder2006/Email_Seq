import { Types, FilterQuery } from 'mongoose';
import { Sequence, ISequence, SequenceStatus } from '../models/Sequence';
import { SequenceStep, ISequenceStep, StepType } from '../models/SequenceStep';
import { SequenceContact } from '../models/SequenceContact';
import { EmailConnection, ConnectionStatus } from '../models/EmailConnection';
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
      status:              SequenceStatus.DRAFT,
    });

    logger.info('Sequence created', { sequenceId: seq._id, userId });
    return seq;
  }

  async findAll(
    userId: string,
    query: ListSequenceQueryDto
  ): Promise<{ sequences: ISequence[]; total: number; page: number; totalPages: number }> {
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

    return {
      sequences,
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

    if (dto.name)        seq.name        = dto.name;
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

    // Hard delete sequence + all its steps
    await Promise.all([
      Sequence.deleteOne({ _id: sequenceId }),
      SequenceStep.deleteMany({ sequence_id: sequenceId }),
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
    const allowed    = ALLOWED_TRANSITIONS[from];

    if (!allowed.includes(to)) {
      throw AppError.badRequest(
        `Cannot transition from "${from}" to "${to}". ` +
        `Allowed: [${allowed.join(', ') || 'none'}]`
      );
    }

    // Guard: must have at least one email step to activate
    if (to === SequenceStatus.ACTIVE) {
      const emailStepCount = await SequenceStep.countDocuments({
        sequence_id: sequenceId,
        type:        StepType.EMAIL,
        is_active:   true,
      });

      if (emailStepCount === 0) {
        throw AppError.badRequest(
          'Cannot activate a sequence with no email steps. ' +
          'Add at least one email step first.'
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

    // If activating, bump active contacts' next_send_at so scheduler picks them up
    if (to === SequenceStatus.ACTIVE && from !== SequenceStatus.ACTIVE) {
      const now = new Date();
      await SequenceContact.updateMany(
        { 
          sequence_id: sequenceId, 
          status: 'active',
          $or: [
            { next_send_at: { $lte: now } },
            { next_send_at: null }
          ]
        },
        { $set: { next_send_at: now } }
      );
      logger.info('Bumped next_send_at for active contacts upon sequence activation', { sequenceId });
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
      await assertTemplateValid(userId, dto.template_id);
      if ((dto as any).email_connection_id) {
        await assertEmailConnectionValid(userId, (dto as any).email_connection_id);
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
      stepData.template_id          = new Types.ObjectId(dto.template_id);
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
}

export const sequenceService = new SequenceService();
