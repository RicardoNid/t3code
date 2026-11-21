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
    const hiddenSettings = {
      providerInstances: { [instanceId]: { driver, enabled: true, config: {} } },
      projectSettingsOverrides: {},
      providerModelPreferences: {
        [instanceId]: { hiddenModels: [selection.model], modelOrder: [] },
      },
    };
    const hiddenOnA = {
      environmentId: "a",
      projectId: null,
      providers: [provider({ instanceId })],
      settings: hiddenSettings,
    };
    expect(collectLoadBalancingProviders([hiddenOnA])[0]?.models).toEqual([]);
    expect(
      collectLoadBalancingProviders([
        hiddenOnA,
        { environmentId: "b", projectId: null, providers: [provider({ instanceId })] },
      ])[0]?.models.map((model) => model.slug),
    ).toEqual([selection.model]);

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

function subscriber(environmentId: string, overrides: Partial<ServerProvider> = {}, cpuCount = 8) {
  return candidate(
    environmentId,
    {
      driver: ProviderDriverKind.make("claudeAgent"),
      auth: { status: "authenticated", type: "pro", email: `${environmentId}@example.com` },
      ...overrides,
    },
    cpuCount,
  );
}
function pickSubscription(
  candidates: readonly LoadBalancingCandidate[],
  extra: Partial<Parameters<typeof chooseLoadBalancedProvider>[0]> = {},
) {
  return pick(candidates, { driver: ProviderDriverKind.make("claudeAgent"), ...extra });
}

describe("subscription quota routing", () => {
  it("requires a subscription on the destination instead of borrowing another machine's account", () => {
    const paid = candidate("paid", {
      driver: ProviderDriverKind.make("claudeAgent"),
      auth: { status: "authenticated", type: "pro", email: "paid@example.com" },
      usageLimits: limits(60),
    });
    const installedOnly = candidate(
      "installed-only",
      {
        ...paid.provider,
        auth: { status: "authenticated", email: "paid@example.com" },
      },
      64,
    );
    const input = { driver: paid.provider.driver };
    expect(pick([installedOnly, paid], input)?.environmentId).toBe("paid");
    expect(pick([installedOnly], input)).toBeNull();
    for (const auth of [
      { status: "unknown" as const, type: "pro", email: "paid@example.com" },
      { status: "authenticated" as const, type: "free", email: "free@example.com" },
      {
        status: "authenticated" as const,
        type: "apiKey",
        label: "Claude Ultra Subscription",
        email: "api@example.com",
      },
      { status: "authenticated" as const, type: "customEndpoint", email: "proxy@example.com" },
    ])
      expect(pick([{ ...paid, provider: { ...paid.provider, auth } }], input)).toBeNull();
    expect(
      collectLoadBalancingProviders(
        [
          { environmentId: "installed-only", projectId: null, providers: [installedOnly.provider] },
          { environmentId: "paid", projectId: null, providers: [paid.provider] },
        ],
        "usage",
      ),
    ).toHaveLength(1);
  });

  it("derives weekly capacity from the actual Claude plan without manual multipliers", () => {
    const pro = candidate(
      "pro",
      {
        driver: ProviderDriverKind.make("claudeAgent"),
        auth: { status: "authenticated", type: "pro", email: "pro@example.com" },
        usageLimits: limits(50),
      },
      16,
    );
    const ultra = candidate("ultra", {
      driver: pro.provider.driver,
      auth: {
        status: "authenticated",
        type: "claude_max_20x_subscription",
        label: "Claude Ultra Subscription",
        email: "ultra@example.com",
      },
      usageLimits: limits(94),
    });
    expect(pick([pro, ultra], { driver: pro.provider.driver })?.environmentId).toBe("ultra");
    expect(
      pick([pro, { ...ultra, provider: { ...ultra.provider, usageLimits: limits(95) } }], {
        driver: pro.provider.driver,
      })?.environmentId,
    ).toBe("pro");
    expect(
      pick([pro, ultra], { driver: pro.provider.driver, strategy: "hardware" })?.environmentId,
    ).toBe("pro");
  });

  it("weights the selected model by subscription price without requiring published quota ratios", () => {
    const plus = candidate(
      "plus",
      {
        driver: ProviderDriverKind.make("codex"),
        auth: {
          status: "authenticated",
          type: "chatgpt",
          label: "ChatGPT Plus Subscription",
          email: "plus@example.com",
        },
        usageLimits: limits(90),
      },
      64,
    );
    const other = candidate("other", {
      driver: plus.provider.driver,
      auth: { ...plus.provider.auth, email: "other@example.com" },
      usageLimits: limits(50),
    });
    const input = { driver: plus.provider.driver };
    expect(pick([plus, other], input)?.environmentId).toBe("other");
    expect(
      pick(
        [
          plus,
          {
            ...other,
            provider: {
              ...other.provider,
              auth: { ...other.provider.auth, label: "ChatGPT Pro 200 Subscription" },
            },
          },
        ],
        input,
      )?.environmentId,
    ).toBe("other");
    for (const [price, used] of [
      [100, 90],
      [200, 95],
      [500, 98],
    ]) {
      const baseline = { ...plus, provider: { ...plus.provider, usageLimits: limits(50) } };
      const priced = {
        ...other,
        provider: {
          ...other.provider,
          auth: { ...other.provider.auth, label: `ChatGPT Pro ${price} Subscription` },
          usageLimits: limits(used!),
        },
      };
      expect(pick([baseline, priced], input)?.environmentId).toBe("plus");
      expect(
        pick(
          [
            baseline,
            { ...priced, provider: { ...priced.provider, usageLimits: limits(used! - 1) } },
          ],
          input,
        )?.environmentId,
      ).toBe("other");
    }
    expect(
      pick(
        [
          {
            ...plus,
            provider: {
              ...plus.provider,
              auth: { ...plus.provider.auth, label: "ChatGPT Free Subscription" },
            },
          },
        ],
        input,
      ),
    ).toBeNull();
  });

  it("never ranks an API model using subscription windows or API cash balances", () => {
    const api = candidate(
      "api",
      {
        usageLimits: {
          ...limits(99),
          apiBalances: [
            {
              vendor: "deepseek",
              credentialFingerprint: "key",
              checkedAt,
              balances: [{ currency: "CNY", total: "99999" }],
            },
          ],
        },
      },
      64,
    );
    const other = candidate("other", { usageLimits: limits(1) });
    expect(pick([api, other])?.environmentId).toBe("api");
  });

  it("uses the newest shared-account snapshot, including exhaustion on another replica", () => {
    const auth = { status: "authenticated" as const, type: "pro", email: "shared@example.com" };
    const older = subscriber(
      "fast",
      { auth, usageLimits: { ...limits(10), checkedAt: "2026-11-06T11:59:00Z" } },
      64,
    );
    const newer = subscriber("slow", { auth, usageLimits: limits(90) });
    const separate = subscriber("separate", { usageLimits: limits(50) });
    expect(pickSubscription([older, newer, separate])?.environmentId).toBe("separate");
    expect(
      pickSubscription([
        older,
        { ...newer, provider: { ...newer.provider, usageLimits: limits(100) } },
      ]),
    ).toBeNull();
    expect(
      pickSubscription([subscriber("no-snapshot", { auth }, 64), newer, separate])?.environmentId,
    ).toBe("separate");
    expect(loadBalancingAccountKey("fast", older.provider)).toBe(
      loadBalancingAccountKey("slow", {
        ...newer.provider,
        auth: { ...auth, email: " SHARED@example.com " },
      }),
    );
  });

  it("blocks exhausted shorter limits and ignores limits belonging to another model family", () => {
    const blocked = subscriber("blocked", {
      usageLimits: { checkedAt, windows: [window(10), window(100, "session")] },
    });
    expect(pickSubscription([blocked])).toBeNull();
    const unrelated = subscriber("usable", {
      usageLimits: {
        checkedAt,
        windows: [window(50), { ...window(100, "session"), id: "seven_day_opus" }],
      },
    });
    expect(pickSubscription([unrelated])?.environmentId).toBe("usable");
    const claude = subscriber("claude", {
      driver: ProviderDriverKind.make("claudeAgent"),
      models: [{ slug: "claude-sonnet", name: "Sonnet", isCustom: false, capabilities: {} }],
      usageLimits: { checkedAt, windows: [window(20), { ...window(100), id: "seven_day_opus" }] },
    });
    expect(
      pickSubscription([claude], {
        driver: claude.provider.driver,
        selection: { ...selection, model: "claude-sonnet" },
      })?.environmentId,
    ).toBe("claude");
    const cursor = subscriber("cursor", {
      driver: ProviderDriverKind.make("cursor"),
      auth: { status: "authenticated", type: "browser", email: "cursor@example.com" },
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
      pickSubscription([cursor], {
        driver: cursor.provider.driver,
        selection: { ...selection, model: "auto" },
      })?.environmentId,
    ).toBe("cursor");
    expect(
      pickSubscription([cursor], {
        driver: cursor.provider.driver,
        selection: { ...selection, model: "gpt" },
      }),
    ).toBeNull();
    const antigravity = subscriber("antigravity", {
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
      pickSubscription([antigravity], {
        driver: antigravity.provider.driver,
        selection: { ...selection, model: "gemini-pro" },
      })?.environmentId,
    ).toBeUndefined();
    expect(
      pick([antigravity], {
        strategy: "hardware",
        driver: antigravity.provider.driver,
        selection: { ...selection, model: "gemini-pro" },
      })?.environmentId,
    ).toBe("antigravity");
  });

  it("does not treat unknown, stale, expired or incomparable quota as full", () => {
    const good = subscriber("known", { usageLimits: limits(90) });
    const unknown = subscriber("unknown", {}, 64);
    for (const usageLimits of [
      undefined,
      { ...limits(0), checkedAt: "2026-11-06T11:54:59Z" },
      { ...limits(0), unavailable: { reason: "probeFailed" as const } },
      { checkedAt, windows: [{ ...window(0), resetsAt: "2026-11-06T11:59:00Z" }] },
    ]) {
      expect(
        pickSubscription([{ ...unknown, provider: { ...unknown.provider, usageLimits } }, good])
          ?.environmentId,
      ).toBe("known");
    }
    expect(
      pickSubscription([
        unknown,
        { ...good, provider: { ...good.provider, usageLimits: undefined } },
      ])?.environmentId,
    ).toBe("unknown");
    expect(
      pickSubscription([
        good,
        subscriber("monthly", { usageLimits: { checkedAt, windows: [window(95, "monthly")] } }, 64),
      ])?.environmentId,
    ).toBe("monthly");
    expect(pickSubscription([{ ...good, resources: null }])?.environmentId).toBe("known");
    expect(pickSubscription([{ ...good, resources: null }], { strategy: "hardware" })).toBeNull();
    expect(pickSubscription([{ ...good, weight: 0 }])).toBeNull();
  });
});
