import { Request } from 'express';

// ─── Authenticated Request ─────────────────────────────────────────
export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

// ─── JWT ──────────────────────────────────────────────────────────
export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// ─── User ─────────────────────────────────────────────────────────
export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}

export interface IUser {
  _id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Email Sequence ────────────────────────────────────────────────
export enum SequenceStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

export enum StepType {
  EMAIL = 'email',
  WAIT = 'wait',
  CONDITION = 'condition',
}

export interface SequenceStep {
  stepId: string;
  type: StepType;
  delayDays: number;
  delayHours: number;
  subject?: string;
  body?: string;
  condition?: string;
}

export interface ISequence {
  _id: string;
  name: string;
  description?: string;
  userId: string;
  status: SequenceStatus;
  steps: SequenceStep[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── Contact / Lead ────────────────────────────────────────────────
export enum ContactStatus {
  SUBSCRIBED = 'subscribed',
  UNSUBSCRIBED = 'unsubscribed',
  BOUNCED = 'bounced',
  COMPLAINED = 'complained',
}

export interface IContact {
  _id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  tags: string[];
  status: ContactStatus;
  customFields: Record<string, string | number | boolean>;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Enrollment ────────────────────────────────────────────────────
export enum EnrollmentStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  PAUSED = 'paused',
  FAILED = 'failed',
  UNSUBSCRIBED = 'unsubscribed',
}

export interface IEnrollment {
  _id: string;
  sequenceId: string;
  contactId: string;
  userId: string;
  currentStepIndex: number;
  status: EnrollmentStatus;
  scheduledAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Email Log ─────────────────────────────────────────────────────
export enum EmailDeliveryStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  DELIVERED = 'delivered',
  OPENED = 'opened',
  CLICKED = 'clicked',
  BOUNCED = 'bounced',
  FAILED = 'failed',
  UNSUBSCRIBED = 'unsubscribed',
}

export interface IEmailLog {
  _id: string;
  enrollmentId: string;
  contactId: string;
  sequenceId: string;
  stepIndex: number;
  subject: string;
  status: EmailDeliveryStatus;
  messageId?: string;
  sentAt?: Date;
  openedAt?: Date;
  clickedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
}

// ─── BullMQ Job Data ───────────────────────────────────────────────
export interface EmailJobData {
  enrollmentId: string;
  contactId: string;
  sequenceId: string;
  stepIndex: number;
  scheduledAt: string; // ISO string
}

// ─── API Response Wrapper ──────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: unknown[];
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

// ─── Pagination ────────────────────────────────────────────────────
export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}
