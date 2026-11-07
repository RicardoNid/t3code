import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  chooseLoadBalancedProvider,
  collectLoadBalancingProviders,
  loadBalancingAccountKey,
  type LoadBalancingCandidate,
} from "./load-balancing.ts";

const isProviderInstanceId = Schema.is(ProviderInstanceId);
const now = Date.parse("2026-11-06T12:00:00Z");
const checkedAt = "2026-11-06T12:00:00Z";
const resetsAt = "2026-11-07T12:00:00Z";
const driver = ProviderDriverKind.make("opencode");
const selection = { instanceId: ProviderInstanceId.make("opencode"), model: "deepseek/chat" };
const resources = {
  sampledAt: now,
  cpuUtilization: 0.2,
  cpuCount: 8,
  availableMemoryBytes: 8000,
  totalMemoryBytes: 16000,
};
const window = (
  usedPercent: number,
  kind: ServerProviderUsageWindow["kind"] = "weekly",
): ServerProviderUsageWindow => ({ id: kind, label: kind, kind, usedPercent, resetsAt });
function provider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: selection.instanceId,
    driver,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [{ slug: selection.model, name: "DeepSeek", isCustom: false, capabilities: {} }],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}
function candidate(
  environmentId: string,
  overrides: Partial<ServerProvider> = {},
  cpuCount = 8,
): LoadBalancingCandidate {
  return {
    environmentId,
    provider: provider(overrides),
    resources: { ...resources, cpuCount },
    weight: 50,
  };
}
const limits = (used: number) => ({ checkedAt, windows: [window(used)] });
function pick(
  candidates: readonly LoadBalancingCandidate[],
  extra: Partial<Parameters<typeof chooseLoadBalancedProvider>[0]> = {},
) {
  return chooseLoadBalancedProvider({
    candidates,
    driver,
    selection,
    now,
    strategy: "usage",
    capacities: {},
    ...extra,
  });
}

describe("automatic model routing", () => {
  it("offers the union of project-enabled models and routes a remote-only model to its actual instance", () => {
    const remoteId = ProviderInstanceId.make("remote-opencode");
    const projectId = ProjectId.make("project");
    const local = candidate(
      "local",
      { models: [{ slug: "kimi/k2", name: "Kimi", isCustom: false, capabilities: {} }] },
      64,
    );
    const remote = candidate("remote", { instanceId: remoteId });
    const union = collectLoadBalancingProviders([
      { environmentId: "local", projectId, providers: [local.provider] },
      {
        environmentId: "remote",
        projectId,
        providers: [
          remote.provider,
          provider({ instanceId: ProviderInstanceId.make("disabled"), enabled: false }),
          provider({
            instanceId: ProviderInstanceId.make("signed-out"),
            auth: { status: "unauthenticated" },
          }),
        ],
      },
    ]);
    expect(union.flatMap((entry) => entry.models.map((model) => model.slug))).toEqual([
      "kimi/k2",
      selection.model,
    ]);
    expect(pick([local, remote], { strategy: "hardware" })).toEqual({
      environmentId: "remote",
      instanceId: remoteId,
    });
    const override = {
      providerInstances: {},
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [remoteId]: { enabled: false } } },
      },
    };
    expect(
      collectLoadBalancingProviders([
        { environmentId: "remote", projectId, providers: [remote.provider], settings: override },
      ]),
    ).toEqual([]);
    const projectEnabled = collectLoadBalancingProviders([
      {
        environmentId: "remote",
        projectId,
        providers: [{ ...remote.provider, enabled: false, status: "disabled" }],
        settings: {
          ...override,
          projectSettingsOverrides: {
            [projectId]: { providerInstances: { [remoteId]: { enabled: true } } },
          },
        },
      },
    ]);
    expect(projectEnabled[0]).toMatchObject({ enabled: true, status: "ready" });
    expect(pick([{ ...remote, provider: projectEnabled[0]! }])?.environmentId).toBe("remote");
  });

  it("merges same-instance model catalogs while separating colliding ids from different drivers", () => {
    const instanceId = ProviderInstanceId.make("p".repeat(64));
    const union = collectLoadBalancingProviders([
      { environmentId: "a", projectId: null, providers: [provider({ instanceId })] },
      {
        environmentId: "b",
        projectId: null,
        providers: [
          provider({
            instanceId,
            models: [{ slug: "kimi/k2", name: "Kimi", isCustom: false, capabilities: {} }],
          }),
          provider({ instanceId, driver: ProviderDriverKind.make("codex") }),
        ],
      },
    ]);
    expect(union).toHaveLength(2);
    expect(union.every((provider) => isProviderInstanceId(provider.instanceId))).toBe(true);
    expect(union.map((provider) => provider.sourceInstanceId)).toEqual([instanceId, instanceId]);
    expect(union[0]?.models.map((model) => model.slug)).toEqual([selection.model, "kimi/k2"]);
    expect(union[0]?.instanceId).not.toBe(union[1]?.instanceId);
    expect(
      pick([
        candidate("other-driver", { driver: ProviderDriverKind.make("codex") }, 64),
        candidate("correct"),
      ])?.environmentId,
    ).toBe("correct");
  });

  it("requires the selected options on the destination and excludes unavailable providers", () => {
    const supported = candidate("supported", {
      models: [
        {
          slug: selection.model,
          name: "DeepSeek",
          isCustom: false,
          capabilities: {
            optionDescriptors: [
              {
                id: "effort",
                type: "select",
                label: "Effort",
                options: [{ id: "high", label: "High" }],
              },
            ],
          },
        },
      ],
    });
    expect(
      pick([candidate("wrong-options", {}, 64), supported], {
        selection: { ...selection, options: [{ id: "effort", value: "high" }] },
      })?.environmentId,
    ).toBe("supported");
    for (const overrides of [
      { enabled: false },
      { installed: false },
      { status: "error" as const },
      { availability: "unavailable" as const },
      { auth: { status: "unauthenticated" as const } },
    ]) {
      expect(pick([candidate("excluded", overrides)])).toBeNull();
    }
  });
});

describe("subscription quota routing", () => {
  it("weights remaining quota by actual plan capacity and uses hardware for ties", () => {
    const small = candidate("small", { usageLimits: limits(50) }, 16);
    const large = candidate("large", { usageLimits: limits(95) });
    const capacities = { [loadBalancingAccountKey("large", large.provider)]: 10 };
    expect(pick([small, large], { capacities })?.environmentId).toBe("small");
    expect(
      pick([small, { ...large, provider: { ...large.provider, usageLimits: limits(94) } }], {
        capacities,
      })?.environmentId,
    ).toBe("large");
    expect(
      pick([small, { ...large, provider: { ...large.provider, usageLimits: limits(94) } }], {
        strategy: "hardware",
        capacities,
      })?.environmentId,
    ).toBe("small");
  });

  it("uses the newest shared-account snapshot, including exhaustion on another replica", () => {
    const auth = { status: "authenticated" as const, email: "shared@example.com" };
    const older = candidate(
      "fast",
      { auth, usageLimits: { ...limits(10), checkedAt: "2026-11-06T11:59:00Z" } },
      64,
    );
    const newer = candidate("slow", { auth, usageLimits: limits(90) });
    const separate = candidate("separate", { usageLimits: limits(50) });
    expect(pick([older, newer, separate])?.environmentId).toBe("separate");
    expect(
      pick([older, { ...newer, provider: { ...newer.provider, usageLimits: limits(100) } }]),
    ).toBeNull();
    expect(pick([candidate("no-snapshot", { auth }, 64), newer, separate])?.environmentId).toBe(
      "separate",
    );
    expect(loadBalancingAccountKey("fast", older.provider)).toBe(
      loadBalancingAccountKey("slow", {
        ...newer.provider,
        auth: { ...auth, email: " SHARED@example.com " },
      }),
    );
  });

  it("blocks exhausted shorter limits and ignores limits belonging to another model family", () => {
    const blocked = candidate("blocked", {
      usageLimits: { checkedAt, windows: [window(10), window(100, "session")] },
    });
    expect(pick([blocked])).toBeNull();
    const unrelated = candidate("usable", {
      usageLimits: {
        checkedAt,
        windows: [window(50), { ...window(100, "session"), id: "go_daily" }],
      },
    });
    expect(pick([unrelated])?.environmentId).toBe("usable");
    const claude = candidate("claude", {
      driver: ProviderDriverKind.make("claudeAgent"),
      models: [{ slug: "claude-sonnet", name: "Sonnet", isCustom: false, capabilities: {} }],
      usageLimits: { checkedAt, windows: [window(20), { ...window(100), id: "seven_day_opus" }] },
    });
    expect(
      pick([claude], {
        driver: claude.provider.driver,
        selection: { ...selection, model: "claude-sonnet" },
      })?.environmentId,
    ).toBe("claude");
    const cursor = candidate("cursor", {
      driver: ProviderDriverKind.make("cursor"),
      models: ["auto", "gpt"].map((slug) => ({
        slug,
        name: slug,
        isCustom: false,
        capabilities: {},
      })),
      usageLimits: {
        checkedAt,
        windows: [
          { ...window(100, "monthly"), id: "apiPercentUsed" },
          { ...window(20, "monthly"), id: "autoPercentUsed" },
        ],
      },
    });
    expect(
      pick([cursor], { driver: cursor.provider.driver, selection: { ...selection, model: "auto" } })
        ?.environmentId,
    ).toBe("cursor");
    expect(
      pick([cursor], { driver: cursor.provider.driver, selection: { ...selection, model: "gpt" } }),
    ).toBeNull();
    const antigravity = candidate("antigravity", {
      driver: ProviderDriverKind.make("antigravity"),
      models: [{ slug: "gemini-pro", name: "Gemini", isCustom: false, capabilities: {} }],
      usageLimits: {
        checkedAt,
        windows: [
          { ...window(20), id: "gemini-pro" },
          { ...window(100), id: "3p-claude" },
        ],
      },
    });
    expect(
      pick([antigravity], {
        driver: antigravity.provider.driver,
        selection: { ...selection, model: "gemini-pro" },
      })?.environmentId,
    ).toBe("antigravity");
  });

  it("does not treat unknown, stale, expired or incomparable quota as full", () => {
    const good = candidate("known", { usageLimits: limits(90) });
    const unknown = candidate("unknown", {}, 64);
    for (const usageLimits of [
      undefined,
      { ...limits(0), checkedAt: "2026-11-06T11:54:59Z" },
      { ...limits(0), unavailable: { reason: "probeFailed" as const } },
      { checkedAt, windows: [{ ...window(0), resetsAt: "2026-11-06T11:59:00Z" }] },
    ]) {
      expect(
        pick([{ ...unknown, provider: { ...unknown.provider, usageLimits } }, good])?.environmentId,
      ).toBe("known");
    }
    expect(
      pick([unknown, { ...good, provider: { ...good.provider, usageLimits: undefined } }])
        ?.environmentId,
    ).toBe("unknown");
    expect(
      pick([
        good,
        candidate("monthly", { usageLimits: { checkedAt, windows: [window(95, "monthly")] } }, 64),
      ])?.environmentId,
    ).toBe("monthly");
    expect(pick([{ ...good, resources: null }])?.environmentId).toBe("known");
    expect(pick([{ ...good, resources: null }], { strategy: "hardware" })).toBeNull();
    expect(pick([{ ...good, weight: 0 }])).toBeNull();
  });
});
