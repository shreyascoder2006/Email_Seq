export interface MergeTagDefinition {
  tag: string;
  name: string;
  label: string;
  desc: string;
}

export const STANDARD_CONTACT_TAGS: MergeTagDefinition[] = [
  { tag: '{{first_name}}', name: 'first_name', label: 'First Name', desc: "Contact's first name" },
  { tag: '{{last_name}}', name: 'last_name', label: 'Last Name', desc: "Contact's last name" },
  { tag: '{{email}}', name: 'email', label: 'Email', desc: "Contact's email address" },
  { tag: '{{company}}', name: 'company', label: 'Company', desc: "Contact's company name" },
];

export const STANDARD_SENDER_TAGS: MergeTagDefinition[] = [
  { tag: '{{sender_name}}', name: 'sender_name', label: 'Sender Name', desc: "Your full name" },
  { tag: '{{sender_email}}', name: 'sender_email', label: 'Sender Email', desc: "Your email address" },
  { tag: '{{signature}}', name: 'signature', label: 'Signature', desc: "Your email signature" },
];

export const STANDARD_SEQUENCE_TAGS: MergeTagDefinition[] = [
  { tag: '{{sequence_name}}', name: 'sequence_name', label: 'Sequence Name', desc: "Name of the current sequence" },
  { tag: '{{step_number}}', name: 'step_number', label: 'Step Number', desc: "Current step in the sequence" },
  { tag: '{{current_date}}', name: 'current_date', label: 'Current Date', desc: "Today's date" },
];

export const ALL_STANDARD_TAGS: MergeTagDefinition[] = [
  ...STANDARD_CONTACT_TAGS,
  ...STANDARD_SENDER_TAGS,
  ...STANDARD_SEQUENCE_TAGS
];

export const ALL_STANDARD_TAG_NAMES = ALL_STANDARD_TAGS.map(t => t.name);
