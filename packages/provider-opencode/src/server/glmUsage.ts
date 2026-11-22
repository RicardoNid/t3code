import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const Limit = Schema.Struct({
  type: Schema.String,
  unit: Schema.optional(Schema.Finite),
  number: Schema.optional(Schema.Finite),
  percentage: Schema.optional(Schema.Finite),
  currentValue: Schema.optional(Schema.Finite),
  remaining: Schema.optional(Schema.Finite),
  usage: Schema.optional(Schema.Finite),
  nextResetTime: Schema.optional(Schema.NullOr(Schema.Finite)),
});
export const GlmQuota = Schema.Struct({
  code: Schema.Number,
  success: Schema.Boolean,
  data: Schema.Union([Schema.Struct({ limits: Schema.Array(Limit) }), Schema.Array(Limit)]),
});

export function glmUsageWindows(body: typeof GlmQuota.Type): ServerProviderUsageWindow[] {
  if (!body.success || body.code !== 200) return [];
  const limits = "limits" in body.data ? body.data.limits : body.data;
  return limits.flatMap((limit): ServerProviderUsageWindow[] => {
    if (limit.type !== "TOKENS_LIMIT" && limit.type !== "CREDIT_LIMIT") return [];
    const minutes =
      limit.unit === 3
        ? (limit.number ?? 5) * 60
        : limit.unit === 6
          ? (limit.number ?? 1) * 10080
          : null;
    if (minutes === null || minutes <= 0) return [];
    const total =
      limit.remaining !== undefined && limit.currentValue !== undefined
        ? limit.remaining + limit.currentValue
        : limit.usage;
    const percentage =
      limit.percentage ??
      (total && total > 0 && limit.currentValue !== undefined
        ? (limit.currentValue / total) * 100
        : undefined);
    if (percentage === undefined) return [];
    const reset = limit.nextResetTime ? DateTime.make(limit.nextResetTime) : Option.none();
    return [
      {
        id: `glm_${limit.unit}_${limit.number ?? 1}`,
        kind: limit.unit === 6 ? "weekly" : "session",
        label: limit.unit === 6 ? "GLM · Weekly" : "GLM · 5 hours",
        windowDurationMins: minutes,
        usedPercent: Math.max(0, Math.min(100, percentage)),
        ...(Option.isSome(reset) ? { resetsAt: DateTime.formatIso(reset.value) } : {}),
      },
    ];
  });
}
