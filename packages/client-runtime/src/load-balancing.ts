import {
  ProviderInstanceId,
  resolveProjectProviderInstanceEnabled,
  type HostResourcesSnapshot,
  type ModelSelection,
  type ProjectId,
  type ProviderDriverKind,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";

/** Callers supply only connected machines hosting the project and selected provider. */
export function chooseLoadBalancedEnvironment(
  candidates: ReadonlyArray<{
    environmentId: string;
    resources: HostResourcesSnapshot | null;
    /** Client receipt time avoids comparing clocks on different machines. */
    receivedAt?: number;
    weight: number;
  }>,
  now: number,
): string | null {
  let selected: string | null = null;
  let bestScore = 0;
  for (const { environmentId, resources, receivedAt, weight } of candidates) {
    const sampledAt = receivedAt ?? resources?.sampledAt ?? 0;
    if (
      !resources ||
      !Number.isFinite(weight) ||
      weight <= 0 ||
      now - sampledAt > 15_000 ||
      sampledAt > now + 5_000 ||
      resources.cpuUtilization === null ||
      resources.cpuUtilization >= 0.95 ||
      resources.totalMemoryBytes <= 0 ||
      resources.cpuCount <= 0
    ) {
      continue;
    }
    const memoryAvailable = resources.availableMemoryBytes / resources.totalMemoryBytes;
    if (memoryAvailable <= 0.05) continue;
    const score = weight * resources.cpuCount * (1 - resources.cpuUtilization) * memoryAvailable;
    if (score > bestScore) {
      selected = environmentId;
      bestScore = score;
    }
  }
  return selected;
}

export interface LoadBalancingSource {
  readonly environmentId: string;
  readonly projectId: ProjectId | null;
  readonly providers: readonly ServerProvider[];
  readonly settings?:
    | Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">
    | undefined;
}

export function eligibleLoadBalancingProviders(source: LoadBalancingSource) {
  return source.providers
    .filter(
      (provider) =>
        (source.settings
          ? resolveProjectProviderInstanceEnabled(
              source.settings,
              source.projectId,
              provider.instanceId,
            )
          : provider.enabled) &&
        provider.installed &&
        provider.status !== "error" &&
        provider.auth.status !== "unauthenticated" &&
        provider.availability !== "unavailable",
    )
    .map((provider) => ({
      ...provider,
      enabled: true,
      status: provider.status === "disabled" ? ("ready" as const) : provider.status,
    }));
}

export function collectLoadBalancingProviders(sources: readonly LoadBalancingSource[]) {
  const union = new Map<
    string,
    ServerProvider & { readonly sourceInstanceId: ProviderInstanceId }
  >();
  const ids = new Set<string>();
  const reservedIds = new Set(
    sources.flatMap((source) => source.providers.map((provider) => provider.instanceId)),
  );
  for (const source of sources) {
    for (const provider of eligibleLoadBalancingProviders(source)) {
      const key = `${provider.driver}:${provider.instanceId}`;
      const previous = union.get(key);
      if (previous) {
        const models = new Map(previous.models.map((model) => [model.slug, model]));
        for (const model of provider.models)
          if (!models.has(model.slug)) models.set(model.slug, model);
        union.set(key, { ...previous, models: [...models.values()] });
      } else {
        // Picker-only collision ids are replaced with the destination's real id before dispatch.
        let instanceId = provider.instanceId;
        if (ids.has(instanceId)) {
          let suffix = 0;
          do {
            instanceId = ProviderInstanceId.make(`balance_${union.size}_${suffix++}`);
          } while (ids.has(instanceId) || reservedIds.has(instanceId));
        }
        ids.add(instanceId);
        union.set(key, { ...provider, instanceId, sourceInstanceId: provider.instanceId });
      }
    }
  }
  return [...union.values()];
}

export function loadBalancingAccountKey(environmentId: string, provider: ServerProvider): string {
  const email = provider.auth.email?.trim().toLowerCase();
  if (email) return `${provider.driver}:account:${email}:${provider.auth.workspaceId ?? ""}`;
  if (provider.usageLimits?.credentialFingerprint)
    return `${provider.driver}:credential:${provider.usageLimits.credentialFingerprint}`;
  return `${environmentId}:${provider.instanceId}`;
}

function applicableWindows(provider: ServerProvider, model: string) {
  return (provider.usageLimits?.windows ?? []).filter((window) => {
    if (provider.driver === "opencode")
      return !window.id.startsWith("go_") || model.startsWith("opencode-go/");
    if (provider.driver === "cursor")
      return (
        window.id === "totalPercentUsed" ||
        window.id === "apiPercentUsed" ||
        (window.id === "autoPercentUsed" && /^(auto|default|grok|composer)/.test(model))
      );
    if (provider.driver === "claudeAgent") {
      const family = window.id.match(/(?:^|_)(opus|sonnet|haiku)(?:_|$)/)?.[1];
      return family === undefined || model.includes(family);
    }
    if (provider.driver === "antigravity") {
      const family = model.match(/^(gemini|claude|gpt)-/)?.[1];
      const pool = window.id.match(/^(gemini|claude|gpt|3p)-/)?.[1];
      return !pool || !family || pool === family || (pool === "3p" && family !== "gemini");
    }
    return true;
  });
}

function quotaScore(provider: ServerProvider, model: string, capacity: number, now: number) {
  const limits = provider.usageLimits;
  const age = now - Date.parse(limits?.checkedAt ?? "");
  if (!limits || limits.unavailable || !Number.isFinite(age) || age < -60_000 || age > 300_000)
    return null;
  const windows = applicableWindows(provider, model).filter(
    (window) => window.resetsAt && Date.parse(window.resetsAt) > now,
  );
  const kind = (["weekly", "monthly", "session"] as const).find((kind) =>
    windows.some((window) => window.kind === kind),
  );
  if (!kind) return null;
  const comparable = windows.filter((window) => window.kind === kind);
  let remaining = comparable.map((window) => (100 - window.usedPercent) / 100);
  if (provider.driver === "cursor" && /^(auto|default|grok|composer)/.test(model)) {
    const pools = comparable.filter(
      (window) => window.id === "autoPercentUsed" || window.id === "apiPercentUsed",
    );
    remaining = comparable
      .filter((window) => window.id === "totalPercentUsed")
      .map((window) => (100 - window.usedPercent) / 100);
    if (pools.length)
      remaining.push(Math.max(...pools.map((window) => (100 - window.usedPercent) / 100)));
  }
  return { kind, remaining: capacity * Math.min(...remaining) };
}

export interface LoadBalancingCandidate {
  readonly environmentId: string;
  readonly provider: ServerProvider;
  readonly resources: HostResourcesSnapshot | null;
  readonly receivedAt?: number;
  readonly weight: number;
}

export function supportsLoadBalancedSelection(
  provider: ServerProvider,
  driver: ProviderDriverKind,
  selection: ModelSelection,
) {
  if (
    provider.driver !== driver ||
    !provider.enabled ||
    !provider.installed ||
    (provider.status !== "ready" && provider.status !== "warning") ||
    provider.auth.status === "unauthenticated" ||
    provider.availability === "unavailable"
  )
    return false;
  // Registry agents can share model names without being interchangeable runtimes.
  if (driver === "acpRegistry" && provider.instanceId !== selection.instanceId) return false;
  const model = provider.models.find(
    (model) => model.slug === selection.model || model.aliases?.includes(selection.model),
  );
  return (
    model !== undefined &&
    (selection.options ?? []).every((selected) => {
      const option = model.capabilities?.optionDescriptors?.find(
        (option) => option.id === selected.id,
      );
      return option?.type === "boolean"
        ? typeof selected.value === "boolean"
        : option?.type === "select" &&
            option.options.some((choice) => choice.id === selected.value);
    })
  );
}

function exhausted(provider: ServerProvider, model: string, now: number) {
  const windows = applicableWindows(provider, model);
  const isExhausted = (window: (typeof windows)[number]) =>
    window.usedPercent >= 100 &&
    (!window.resetsAt ||
      !Number.isFinite(Date.parse(window.resetsAt)) ||
      Date.parse(window.resetsAt) > now);
  if (provider.driver === "cursor" && /^(auto|default|grok|composer)/.test(model)) {
    return (
      windows.some((window) => window.id === "totalPercentUsed" && isExhausted(window)) ||
      ["autoPercentUsed", "apiPercentUsed"].every((id) =>
        windows.some((window) => window.id === id && isExhausted(window)),
      )
    );
  }
  return windows.some(isExhausted);
}

export function chooseLoadBalancedProvider(input: {
  readonly candidates: readonly LoadBalancingCandidate[];
  readonly driver: ProviderDriverKind;
  readonly selection: ModelSelection;
  readonly strategy: "hardware" | "usage";
  readonly capacities: Readonly<Record<string, number>>;
  readonly now: number;
}) {
  const matching = input.candidates.filter(
    ({ provider, weight }) =>
      weight > 0 &&
      Number.isFinite(weight) &&
      supportsLoadBalancedSelection(provider, input.driver, input.selection),
  );
  const latest = new Map<string, ServerProvider>();
  for (const candidate of matching) {
    const key = loadBalancingAccountKey(candidate.environmentId, candidate.provider);
    const previous = latest.get(key);
    if (
      !previous ||
      (Date.parse(candidate.provider.usageLimits?.checkedAt ?? "") || 0) >
        (Date.parse(previous.usageLimits?.checkedAt ?? "") || 0)
    )
      latest.set(key, candidate.provider);
  }
  const ranked = matching
    .filter(
      (candidate) =>
        !exhausted(
          latest.get(loadBalancingAccountKey(candidate.environmentId, candidate.provider)) ??
            candidate.provider,
          input.selection.model,
          input.now,
        ),
    )
    .map((candidate, index) => {
      const accountKey = loadBalancingAccountKey(candidate.environmentId, candidate.provider);
      const rawCapacity = input.capacities[accountKey] ?? 1;
      const capacity = Number.isFinite(rawCapacity) && rawCapacity > 0 ? rawCapacity : 1;
      const quota = quotaScore(
        latest.get(accountKey) ?? candidate.provider,
        input.selection.model,
        capacity,
        input.now,
      );
      // Reuse exactly the hardware policy, including its freshness and saturation guards.
      const hardware =
        chooseLoadBalancedEnvironment([candidate], input.now) === null
          ? 0
          : (candidate.weight *
              candidate.resources!.cpuCount *
              (1 - candidate.resources!.cpuUtilization!) *
              candidate.resources!.availableMemoryBytes) /
            candidate.resources!.totalMemoryBytes;
      return { ...candidate, index, quota, hardware };
    });
  const kinds = new Set(
    ranked.flatMap((candidate) => (candidate.quota ? [candidate.quota.kind] : [])),
  );
  const useQuota = input.strategy === "usage" && kinds.size === 1;
  const eligible = ranked.filter(
    (candidate) => (useQuota && candidate.quota !== null) || candidate.hardware > 0,
  );
  eligible.sort(
    (a, b) =>
      (useQuota ? (b.quota?.remaining ?? -1) - (a.quota?.remaining ?? -1) : 0) ||
      b.hardware - a.hardware ||
      a.index - b.index,
  );
  const selected = eligible[0];
  return selected
    ? { environmentId: selected.environmentId, instanceId: selected.provider.instanceId }
    : null;
}
