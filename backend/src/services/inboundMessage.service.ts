import mongoose from 'mongoose';
import { SendingLog, SendStatus } from '../models/SendingLog';
import { SequenceContact, ContactEnrollmentStatus } from '../models/SequenceContact';
import { BounceLog, BounceType, BounceSubType } from '../models/BounceLog';
import { ReplyLog, ReplyClassification } from '../models/ReplyLog';
import logger from '../config/logger';

export class InboundMessageService {
  
  /**
   * Classify and process an incoming IMAP message.
   */
  async processMessage(
    connectionId: mongoose.Types.ObjectId,
    envelope: any,
    sourceText: string,
    uid: number
  ): Promise<'bounce' | 'reply' | 'ignored'> {
    
    const fromAddress = envelope.from?.[0]?.address?.toLowerCase() || '';
    const subject     = envelope.subject?.toLowerCase() || '';
    
    const isMailerDaemon = fromAddress.includes('mailer-daemon') || fromAddress.includes('postmaster') || fromAddress.includes('bounce');
    const isDeliveryStatus = subject.includes('delivery status notification') || subject.includes('undeliverable') || subject.includes('returned mail');

    if (isMailerDaemon || isDeliveryStatus) {
      return this.processBounce(connectionId, envelope, sourceText);
    } else if (envelope.inReplyTo) {
      return this.processReply(connectionId, envelope);
    }
    
    return 'ignored';
  }

  private async processBounce(
    connectionId: mongoose.Types.ObjectId,
    envelope: any,
    sourceText: string
  ): Promise<'bounce' | 'ignored'> {
    // 1. Correlate Message
    const originalMessageIdMatch = sourceText.match(/Original-Message-ID:\s*<([^>]+)>/i) 
                                || sourceText.match(/References:\s*(?:.*?\s)?<([^>]+)>/i)
                                || sourceText.match(/In-Reply-To:\s*<([^>]+)>/i);
    
    if (!originalMessageIdMatch) {
      logger.debug('[InboundMessageService] DSN lacked Message-ID references. Ignored.');
      return 'ignored';
    }

    const cleanMessageId = originalMessageIdMatch[1].replace(/[<>]/g, '');
    const sendingLog = await SendingLog.findOne({
      email_connection_id: connectionId,
      message_id: { $regex: new RegExp(cleanMessageId, 'i') },
    });

    if (!sendingLog) {
      logger.debug(`[InboundMessageService] DSN Message-ID ${cleanMessageId} not found in SendingLogs. Ignored.`);
      return 'ignored';
    }

    // Check if already processed
    const existingBounce = await BounceLog.exists({ sending_log_id: sendingLog._id });
    if (existingBounce) return 'ignored';

    // 2. Classify Bounce
    let bounceType = BounceType.HARD;
    let bounceSubType = BounceSubType.UNKNOWN;
    
    // Fallback classification using RFC 3463 SMTP codes in raw text
    if (sourceText.match(/\b5\.\d\.\d\b|\b5\d{2}\b/)) {
       bounceType = BounceType.HARD;
       bounceSubType = BounceSubType.INVALID_ADDRESS;
    } else if (sourceText.match(/\b4\.\d\.\d\b|\b4\d{2}\b/)) {
       bounceType = BounceType.SOFT;
       bounceSubType = BounceSubType.MAILBOX_FULL;
    }

    // 3. Atomic Transaction
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      await BounceLog.create([{
        sequence_id:         sendingLog.sequence_id,
        sequence_contact_id: sendingLog.sequence_contact_id,
        sending_log_id:      sendingLog._id,
        user_id:             sendingLog.user_id,
        email_connection_id: sendingLog.email_connection_id,
        to_email:            sendingLog.to_email,
        step_index:          sendingLog.step_index,
        bounce_type:         bounceType,
        bounce_sub_type:     bounceSubType,
        is_handled:          true,
        bounced_at:          envelope.date || new Date(),
        expires_at:          new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      }], { session });

      await SequenceContact.updateOne(
        { _id: sendingLog.sequence_contact_id },
        { status: ContactEnrollmentStatus.BOUNCED, has_bounced: true, next_send_at: null },
        { session }
      );

      await SendingLog.updateOne(
        { _id: sendingLog._id },
        { status: SendStatus.BOUNCED },
        { session }
      );

      // We explicitly DO NOT update Sequence.stats to enforce logs as single source of truth

      await session.commitTransaction();
      logger.info(`[InboundMessageService] Recorded ${bounceType.toUpperCase()} BOUNCE for ${sendingLog.to_email}`);
      return 'bounce';
    } catch (error) {
      await session.abortTransaction();
      logger.error(`[InboundMessageService] Bounce transaction failed: ${(error as Error).message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }

  private async processReply(
    connectionId: mongoose.Types.ObjectId,
    envelope: any
  ): Promise<'reply' | 'ignored'> {
    const cleanInReplyTo = envelope.inReplyTo.replace(/[<>]/g, '');
    
    const sendingLog = await SendingLog.findOne({
      email_connection_id: connectionId,
      message_id: { $regex: new RegExp(cleanInReplyTo, 'i') },
    });

    if (!sendingLog) return 'ignored';

    const existingReply = await ReplyLog.exists({
      sending_log_id: sendingLog._id,
      message_id: envelope.messageId,
    });
    
    if (existingReply) return 'ignored';

    const fromAddress = envelope.from?.[0]?.address || 'unknown';
    const fromName    = envelope.from?.[0]?.name || '';

    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      await ReplyLog.create([{
        sequence_id:         sendingLog.sequence_id,
        sequence_contact_id: sendingLog.sequence_contact_id,
        sending_log_id:      sendingLog._id,
        user_id:             sendingLog.user_id,
        from_email:          fromAddress,
        from_name:           fromName,
        to_email:            sendingLog.from_email,
        subject:             envelope.subject || 'Re: Unknown',
        message_id:          envelope.messageId,
        in_reply_to:         envelope.inReplyTo,
        replied_to_step_index: sendingLog.step_index,
        classification:      ReplyClassification.UNKNOWN,
        received_at:         envelope.date || new Date(),
      }], { session });

      await SequenceContact.updateOne(
        { _id: sendingLog.sequence_contact_id },
        { status: ContactEnrollmentStatus.REPLIED, has_replied: true, next_send_at: null },
        { session }
      );

      // We explicitly DO NOT update Sequence.stats to enforce logs as single source of truth

      await session.commitTransaction();
      logger.info(`[InboundMessageService] Recorded REPLY for ${sendingLog.to_email}`);
      return 'reply';
    } catch (error) {
      await session.abortTransaction();
      logger.error(`[InboundMessageService] Reply transaction failed: ${(error as Error).message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }
}

export const inboundMessageService = new InboundMessageService();
