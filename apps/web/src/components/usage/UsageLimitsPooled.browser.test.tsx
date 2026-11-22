import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { UsageLimitsPooled } from "./UsageLimitsPooled";

const checkedAt = "2026-10-25T16:00:00.000Z";

function managedChatGpt(instanceId: string, displayName: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    displayName,
    enabled: true,
    installed: true,
    version: "0.164.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [],
      unavailable: { reason: "unsupported", message: "Track usage in ChatGPT." },
      externalUsage: { label: "ChatGPT usage", url: CHATGPT_USAGE_URL },
    },
  };
}

describe("UsageLimitsPooled ChatGPT usage card", () => {
  it("names the managed connections it covers", async () => {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              managedChatGpt("chatgpt_work", "ChatGPT Work"),
              managedChatGpt("chatgpt_personal", "ChatGPT Personal"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    await expect
      .element(screen.getByText("ChatGPT Work on Desk, ChatGPT Personal on Desk"))
      .toBeVisible();
    await expect
      .element(screen.getByText("View usage in ChatGPT with your connected account."))
      .toBeVisible();
  });
});

it("keeps a single API balance through refresh and filtering while hiding subscription emptiness", async () => {
  const balance = {
    vendor: "deepseek",
    credentialFingerprint: "hashed-credential",
    checkedAt,
    balances: [{ currency: "CNY", total: "12.345" }],
  };
  const account = {
    ...managedChatGpt("opencode", "OpenCode"),
    driver: ProviderDriverKind.make("opencode"),
    usageLimits: {
      checkedAt,
      windows: [],
      apiBalances: [balance],
      unavailable: { reason: "unsupported" as const },
    },
  };
  const desk = { entry: { target: { label: "Desk" } }, serverConfig: { providers: [account] } };
  const laptop = { entry: { target: { label: "Laptop" } }, serverConfig: { providers: [account] } };
  const presentations = new Map([
    [EnvironmentId.make("desk"), desk],
    [EnvironmentId.make("laptop"), laptop],
  ]);
  await using screen = await render(
    <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
  );
  await expect.element(screen.getByText("12.345 CNY", { exact: true })).toBeVisible();
  await expect
    .element(
      screen.getByText("No provider on the selected environments reports subscription limits."),
    )
    .not.toBeInTheDocument();
  await screen.rerender(
    <UsageLimitsPooled
      presentations={new Map([[EnvironmentId.make("desk"), desk]])}
      now={Date.parse(checkedAt)}
    />,
  );
  await expect.element(screen.getByText("12.345 CNY", { exact: true })).toBeVisible();
  await screen.rerender(
    <UsageLimitsPooled
      presentations={
        new Map([
          [
            EnvironmentId.make("desk"),
            {
              ...desk,
              serverConfig: {
                providers: [
                  {
                    ...account,
                    usageLimits: {
                      ...account.usageLimits,
                      apiBalances: [
                        {
                          ...balance,
                          checkedAt: "2026-10-25T17:00:00.000Z",
                          balances: [],
                          unavailable: "probeFailed",
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        ])
      }
      now={Date.parse(checkedAt)}
    />,
  );
  await expect.element(screen.getByText("Balance unavailable. Refresh to retry.")).toBeVisible();
  await expect.element(screen.getByText("12.345 CNY", { exact: true })).not.toBeInTheDocument();
});

it("keeps GLM subscription quotas distinct from balances and deduplicates the same seat across devices", async () => {
  const balance = {
    vendor: "glm",
    credentialFingerprint: "glm-seat",
    checkedAt,
    accountType: "subscription" as const,
    balances: [],
    windows: [
      {
        id: "glm_3_5",
        kind: "session" as const,
        label: "GLM · 5 hours",
        usedPercent: 1,
        windowDurationMins: 300,
      },
      {
        id: "glm_6_1",
        kind: "weekly" as const,
        label: "GLM · Weekly",
        usedPercent: 5,
        windowDurationMins: 10080,
      },
    ],
  };
  const account = {
    ...managedChatGpt("opencode", "OpenCode"),
    driver: ProviderDriverKind.make("opencode"),
    usageLimits: { checkedAt, windows: [], apiBalances: [balance] },
  };
  const presentation = {
    entry: { target: { label: "Device" } },
    serverConfig: { providers: [account] },
  };
  await using screen = await render(
    <UsageLimitsPooled
      presentations={
        new Map([
          [EnvironmentId.make("a"), presentation],
          [EnvironmentId.make("b"), presentation],
        ])
      }
      now={Date.parse(checkedAt)}
    />,
  );
  await expect.element(screen.getByRole("region", { name: "API subscriptions" })).toBeVisible();
  await expect.element(screen.getByText("99% left", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("95% left", { exact: true })).toBeVisible();
  expect(screen.getByText("GLM · 5 hours", { exact: true }).all()).toHaveLength(1);
  await expect.element(screen.getByText("Balance lookup unavailable")).not.toBeInTheDocument();
});
