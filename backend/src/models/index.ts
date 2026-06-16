/**
 * src/models/index.ts
 * Central export for all Mongoose models.
 * Import from here throughout the app to avoid circular deps.
 */

// ─── Domain models ────────────────────────────────────────────────
export { EmailConnection }   from './EmailConnection';
export { Template }          from './Template';
export { Sequence }          from './Sequence';
export { SequenceStep }      from './SequenceStep';
export { SequenceContact }   from './SequenceContact';

// ─── Event log models ─────────────────────────────────────────────
export { SendingLog }  from './SendingLog';
export { ReplyLog }    from './ReplyLog';
export { BounceLog }   from './BounceLog';
export { OpenLog }     from './OpenLog';
export { ClickLog }    from './ClickLog';

// ─── TypeScript interfaces (re-export for convenience) ─────────────
export type { IEmailConnection }  from './EmailConnection';
export type { ITemplate }         from './Template';
export type { ISequence }         from './Sequence';
export type { ISequenceStep }     from './SequenceStep';
export type { ISequenceContact }  from './SequenceContact';
export type { ISendingLog }       from './SendingLog';
export type { IReplyLog }         from './ReplyLog';
export type { IBounceLog }        from './BounceLog';
export type { IOpenLog }          from './OpenLog';
export type { IClickLog }         from './ClickLog';

// ─── Enums (re-export for use in validators / routes) ──────────────
export { SmtpEncryption, ConnectionStatus, ProviderType } from './EmailConnection';
export { TemplateCategory }                               from './Template';
export { SequenceStatus, SendingSchedule }                from './Sequence';
export { StepType, ConditionType }                        from './SequenceStep';
export { ContactEnrollmentStatus, UnsubscribeSource }     from './SequenceContact';
export { SendStatus }                                     from './SendingLog';
export { ReplyClassification }                            from './ReplyLog';
export { BounceType, BounceSubType }                      from './BounceLog';
