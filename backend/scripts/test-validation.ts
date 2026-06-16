import { z } from 'zod';

enum SendingSchedule {
  WEEKDAYS_ONLY = 'weekdays_only',
  ALL_DAYS      = 'all_days',
  CUSTOM        = 'custom',
}

const SendingWindowSchema = z.object({
  timezone: z.string().trim().default('UTC'),
  schedule: z.nativeEnum(SendingSchedule).default(SendingSchedule.WEEKDAYS_ONLY),
  start_hour: z.number().int().min(0).max(23).default(9),
  end_hour: z.number().int().min(0).max(23).default(17),
  custom_days: z.array(z.number().int().min(0).max(6)).optional(),
}).refine(
  (d) => d.start_hour < d.end_hour,
  { message: 'start_hour must be before end_hour', path: ['start_hour'] }
).refine(
  (d) => d.schedule !== SendingSchedule.CUSTOM || (d.custom_days && d.custom_days.length > 0),
  { message: 'custom_days is required when schedule is "custom"', path: ['custom_days'] }
);

const objectIdField = z.string().regex(/^[a-f\d]{24}$/i);

const CreateSequenceSchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).optional(),
  email_connection_id: objectIdField.optional(),
  sending_window: SendingWindowSchema.optional(),
});

const payload = {
  name: "Test",
  description: "",
  sending_window: { timezone: "Asia/Kolkata" }
};

const result = CreateSequenceSchema.safeParse(payload);
if (!result.success) {
  console.dir(result.error.format(), { depth: null });
} else {
  console.log("Success:", result.data);
}
