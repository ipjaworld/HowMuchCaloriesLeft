import { z } from "zod";
import {
  ACTIVITY_LEVELS,
  GOAL_MODES,
  PROFILE_BOUNDS,
  SEXES,
} from "@/domain/dietProfile";
const bounded = (field: keyof typeof PROFILE_BOUNDS) =>
  z.number().min(PROFILE_BOUNDS[field].min).max(PROFILE_BOUNDS[field].max);
export const dietProfileSchema = z.object({
  weightKg: bounded("weightKg"),
  heightCm: bounded("heightCm"),
  age: bounded("age").int(),
  sex: z.enum(SEXES),
  activityLevel: z.enum(ACTIVITY_LEVELS),
  goalMode: z.enum(GOAL_MODES),
  updatedAt: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime())),
});
