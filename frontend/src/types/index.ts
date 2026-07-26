export interface User {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  organization_name?: string;
}

export interface AuthResponse {
  message: string;
  data: {
    token: string;
    user: User;
  };
}

export interface EmailConnection {
  _id: string;
  label: string;
  provider: string;
  from_name: string;
  from_email: string;
  reply_to?: string;
  
  smtp_host: string;
  smtp_port: number;
  smtp_encryption: 'tls' | 'ssl' | 'none';
  smtp_username: string;

  imap_host?: string;
  imap_port?: number;
  imap_encryption?: 'tls' | 'ssl' | 'none';
  imap_username?: string;

  daily_limit: number;
  hourly_limit: number;
  min_interval_seconds: number;

  status: 'active' | 'inactive' | 'failed' | 'pending';
  failure_reason?: string;
  total_sent?: number;
  total_bounced?: number;
  
  last_used_at?: string;
  last_verified_at?: string;
  last_imap_poll_at?: string;
  
  created_at: string;
}

export interface CreateEmailConnectionDto {
  label: string;
  from_name: string;
  from_email: string;
  reply_to?: string;
  provider?: string;
  
  smtp_host: string;
  smtp_port: number;
  smtp_encryption: 'tls' | 'ssl' | 'none';
  smtp_username: string;
  smtp_password?: string; // plain text for creation

  imap_host?: string;
  imap_port?: number;
  imap_encryption?: 'tls' | 'ssl' | 'none';
  imap_username?: string;
  imap_password?: string; // plain text for creation

  daily_limit?: number;
  hourly_limit?: number;
  min_interval_seconds?: number;
}

export interface UpdateEmailConnectionDto extends Partial<CreateEmailConnectionDto> {}

export interface Sequence {
  _id: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'paused' | 'archived' | 'completed';
  step_count: number;
  launch_date: string;
  daily_sending_limit: number;
  reserved_limit_phase1: number;
  warmup_percentage?: number;
  created_at: string;
  needs_attention?: boolean;
  integrity_error?: boolean;
  last_integrity_error?: string | null;
  // Enriched by findAll() aggregations
  pending_count?: number;
  last_activity_at?: string | null;
  stats: {
    total_contacts: number;
    active_contacts: number;
    paused_contacts: number;
    completed: number;
    unsubscribed: number;
    total_sent: number;
    total_opens: number;
    total_clicks: number;
    total_replies: number;
    total_bounces: number;
  };
  sending_window?: {
    days: number[];
    start_time: string;
    end_time: string;
    timezone: string;
  };
}

export interface CreateSequenceDto {
  name: string;
  description?: string;
  launch_date: string;
  daily_sending_limit: number;
  reserved_limit_phase1: number;
  warmup_percentage?: number;
  sending_window?: {
    timezone: string;
    schedule?: string;
    start_hour?: number;
    start_minute?: number;
    end_hour?: number;
    end_minute?: number;
    custom_days?: number[];
  };
  is_wizard?: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface Template {
  _id: string;
  name: string;
  subject: string;
  body_html: string;
  category?: string;
  variables?: { name: string; default_value: string }[];
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateDto {
  name: string;
  subject: string;
  body_html: string;
  category?: string;
}

export interface UpdateTemplateDto extends Partial<CreateTemplateDto> {}

export type StepType = 'email' | 'wait' | 'condition';

export interface SequenceStep {
  _id: string;
  sequence_id: string;
  step_index: number;
  type: StepType;
  delay_days: number;
  delay_hours: number;
  template_id?: string;
  email_connection_id?: string;
  subject_override?: string;
  body_html_override?: string;
  body_text_override?: string;
  cc?: string[];
  bcc?: string[];
  track_opens?: boolean;
  track_clicks?: boolean;
  is_active: boolean;
}

export interface CreateStepDto {
  type: StepType;
  delay_days?: number;
  delay_hours?: number;
  template_id?: string;
  email_connection_id?: string;
  subject_override?: string;
  body_html_override?: string;
  body_text_override?: string;
  cc?: string[];
  bcc?: string[];
  track_opens?: boolean;
  track_clicks?: boolean;
}

export interface UpdateStepDto extends Partial<CreateStepDto> {}

export interface ReorderStepsDto {
  step_ids: string[];
}

export type ContactEnrollmentStatus = 
  | 'active'
  | 'paused'
  | 'completed'
  | 'unsubscribed'
  | 'bounced'
  | 'replied'
  | 'failed'
  | 'skipped'
  | 'removed';

export interface SequenceContact {
  _id: string;
  sequence_id: string;
  contact_email: string;
  contact_first_name: string;
  contact_last_name?: string;
  contact_company?: string;
  status: ContactEnrollmentStatus;
  next_send_at: string | null;
  current_step_index: number;
  total_steps: number;
  has_opened: boolean;
  has_clicked: boolean;
  has_replied: boolean;
  enrolled_at: string;
  unsubscribed_at?: string;
  last_error?: string;
  custom_variables?: Record<string, string>;
}

export interface EnrollContactItem {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  custom_variables?: Record<string, string>;
}

export interface EnrollContactsDto {
  contacts: EnrollContactItem[];
  start_at?: string;
  skip_existing?: boolean;
}

// ─── Import Lists ──────────────────────────────────────────────────

export interface FieldMapping {
  csv_column:   string;  // original CSV header
  system_field: string;  // mapped key (e.g. "first_name" or custom "pain_point")
  merge_tag:    string;  // e.g. "{{first_name}}"
  is_system:    boolean; // true = built-in field
}

export interface ImportList {
  _id:              string;
  user_id:          string;
  name:             string;
  description:      string;
  filename:         string;
  original_headers: string[];
  field_mappings:   FieldMapping[];
  row_count:        number;
  valid_count:      number;
  duplicate_count:  number;
  error_count:      number;
  status:           'pending' | 'mapped' | 'imported';
  created_at:       string;
  updated_at:       string;
}

export interface MappedContactData {
  email:            string;
  first_name?:      string;
  last_name?:       string;
  company?:         string;
  custom_variables: Record<string, string>;
}

export interface ImportedContact {
  _id:               string;
  import_list_id:    string;
  row_data:          Record<string, string>;
  mapped_data:       MappedContactData;
  row_number:        number;
  is_duplicate:      boolean;
  validation_errors: string[];
  created_at:        string;
}

export interface ParsePreviewResult {
  headers:        string[];
  preview_rows:   Record<string, string>[];
  all_rows:       Record<string, string>[];
  total_rows:     number;
  field_mappings: FieldMapping[];
}

export interface ImportSaveResult {
  import_list:   ImportList;
  total:         number;
  valid:         number;
  duplicates:    number;
  errors:        number;
  error_details: Array<{ row: number; email: string; reason: string }>;
}

export interface CreateImportListDto {
  name:             string;
  filename:         string;
  original_headers: string[];
  field_mappings:   FieldMapping[];
  rows:             Record<string, string>[];
}

export interface EnrollImportResult {
  import_list_id: string;
  sequence_id:    string;
  enrolled:       number;
  skipped:        number;
  failed:         number;
  isOutsideWindow?: boolean;
  nextAvailableWindow?: string;
  errors:         Array<{ email: string; reason: string }>;
}

export interface SenderAnalyticsResponse {
  connectionId: string;
  email: string;
  label: string;
  status: string;
  sent: number;
  opens: number;
  replies: number;
  bounces: number;
  dailyVolume: number;
  dailyLimit: number;
  openRate: number;
  replyRate: number;
  bounceRate: number;
  limitUsagePercent: number;
  health: 'excellent' | 'healthy' | 'warning' | 'critical';
  lastSentAt?: string;
}

export interface SequenceWithSteps {
  sequence: Sequence;
  steps: SequenceStep[];
}

export interface StepIntegrityIssue {
  step_id: string;
  step_index: number;
  issues: string[];
}

export interface SequenceIntegrity {
  is_valid: boolean;
  issues: StepIntegrityIssue[];
}
