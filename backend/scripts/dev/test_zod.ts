import { z } from 'zod';

const StepType = { EMAIL: 'email', WAIT: 'wait' };

const objectIdField = z.string().regex(/^[a-f\d]{24}$/i);

const EmailStepSchema = z.object({
  type: z.literal('email'),
  template_id: objectIdField,
  email_connection_id: objectIdField.optional(),
});

const WaitStepBaseSchema = z.object({
  type: z.literal('wait'),
  delay_days: z.number().optional(),
  delay_hours: z.number().optional(),
});

const UpdateStepSchema = z.discriminatedUnion('type', [
  EmailStepSchema.partial().extend({ type: z.literal('email') }),
  WaitStepBaseSchema.partial().extend({ type: z.literal('wait') }),
]);

// Case 1: Missing type field — what the frontend currently sends for updateStep
const withoutType = {
  template_id: "6a329198577f3c3e9d35d23f",
  email_connection_id: "6a30f7746e3980a461787104",
  subject_override: "Hello World",
};

// Case 2: With type field — the correct payload  
const withType = {
  type: "email",
  template_id: "6a329198577f3c3e9d35d23f",
  email_connection_id: "6a30f7746e3980a461787104",
};

console.log("=== WITHOUT type field (current bug) ===");
const r1 = UpdateStepSchema.safeParse(withoutType);
console.log("success:", r1.success);
if (!r1.success) console.log("error:", JSON.stringify(r1.error.issues, null, 2));

console.log("\n=== WITH type field (the fix) ===");
const r2 = UpdateStepSchema.safeParse(withType);
console.log("success:", r2.success);
if (!r2.success) console.log("error:", r2.error.issues);
else console.log("data:", r2.data);
