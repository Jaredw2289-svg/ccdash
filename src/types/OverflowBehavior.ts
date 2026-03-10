import { z } from 'zod';

export const OverflowBehaviorSchema = z.enum(['hide', 'wrap']);

export type OverflowBehavior = z.infer<typeof OverflowBehaviorSchema>;