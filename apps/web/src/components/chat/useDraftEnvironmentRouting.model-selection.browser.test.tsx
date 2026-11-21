import { RegistryContext } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { collectLoadBalancingProviders } from "@t3tools/client-runtime/load-balancing";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { getAppModelOptionsForInstance } from "../../modelSelection";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { render, act } from "../../../test/render";
import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { useDraftEnvironmentRouting } from "./useDraftEnvironmentRouting";

import { serverEnvironment } from "../../state/server";
import "~/index.css";

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: () => [],
}));
vi.mock("../../hooks/useScratchProject", () => ({
  useScratchProject: () => ({ openScratchProject: vi.fn() }),
}));

it("routes a picked remote-only model to its real instance and preserves draft content and options", async () => {
  using _now = vi.spyOn(Date, "now").mockReturnValue(100000);
  const hostResources = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      AsyncResult.success(
        {
          sampledAt: 0,
          cpuUtilization: 0.1,
          cpuCount: environmentId === "a" ? 64 : 8,
          availableMemoryBytes: 8000,
          totalMemoryBytes: 16000,
        },
        { timestamp: 100000 },
      ),
    ),
  );
  using _resources = vi
    .spyOn(serverEnvironment, "hostResources")
    .mockImplementation(({ environmentId }) => hostResources(environmentId));
  const a = EnvironmentId.make("a");
  const b = EnvironmentId.make("b");
  const projectA = ProjectId.make("project-a");
  const projectB = ProjectId.make("project-b");
  const draftId = DraftId.make("load-balance-browser");
  const driver = ProviderDriverKind.make("opencode");
  const remoteInstance = ProviderInstanceId.make("remote-opencode");
  const model = (slug: string, name: string) => ({
    slug,
    name,
    isCustom: slug === "deepseek/chat",
    capabilities: {
      optionDescriptors: [
        {
          id: "effort",
          type: "select" as const,
          label: "Effort",
          options: [{ id: "high", label: "High" }],
        },
      ],
    },
  });
  const provider = (
    instanceId: ProviderInstanceId,
    models: ServerProvider["models"],
  ): ServerProvider => ({
    instanceId,
    displayName: instanceId === remoteInstance ? "Remote OpenCode" : "Local OpenCode",
    driver,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-06T12:00:00Z",
    models,
    slashCommands: [],
    skills: [],
  });
  const sources = [
    {
      environmentId: a,
      projectId: projectA,
      providers: [provider(ProviderInstanceId.make("opencode"), [model("kimi/k2", "Kimi")])],
    },
    {
      environmentId: b,
      projectId: projectB,
      providers: [provider(remoteInstance, [model("deepseek/chat", "DeepSeek")])],
    },
  ];
  const environments = [
    {
      environmentId: a,
      projectId: projectA,
      label: "A",
      isPrimary: true,
      machine: "linux" as const,
    },
    {
      environmentId: b,
      projectId: projectB,
      label: "B",
      isPrimary: false,
      machine: "laptop" as const,
    },
  ];
  const previous = useComposerDraftStore.getState();
  using _store = {
    [Symbol.dispose]() {
      useComposerDraftStore.setState(previous, true);
    },
  };
  previous.setProjectDraftThreadId(scopeProjectRef(a, projectA), draftId, {
    threadId: ThreadId.make("load-balance-thread"),
  });
  previous.setPrompt(draftId, "keep my draft");
  previous.setModelSelection(
    draftId,
    {
      instanceId: ProviderInstanceId.make("opencode"),
      model: "kimi/k2",
      options: [{ id: "effort", value: "high" }],
    },
    { explicit: true },
  );

  function Draft() {
    const draft = useComposerDraftStore((store) => store.getDraftThread(draftId));
    const selection = useComposerDraftStore((store) => {
      const composer = store.getComposerDraft(draftId);
      return composer?.activeProvider
        ? composer.modelSelectionByProvider[composer.activeProvider]
        : null;
    });
    const union = collectLoadBalancingProviders(sources);
    const entries = deriveProviderInstanceEntries(union);
    const routing = useDraftEnvironmentRouting({
      draftId,
      draftThread: draft,
      envLocked: false,
      automaticEnvironment: draft?.environmentSelection !== "manual",
      logicalProjectEnvironments: environments,
      loadBalancingSources: sources,
      loadBalancingSettings: {
        loadBalancingStrategy: "hardware",
        loadBalancingWeights: {},
      },
      modelSelection: selection ?? null,
      selectedProvider: driver,
      referencedThreadContexts: [],
      composerHasAttachments: false,
      activeProjectKey: "project",
      activeProjectIsScratch: false,
      projectGroupingSettings: {
        sidebarProjectGroupingMode: "repository",
        sidebarProjectGroupingOverrides: {},
      },
      sendInFlightRef: { current: false },
    });
    const change = (instanceId: ProviderInstanceId, model: string) => {
      const store = useComposerDraftStore.getState();
      const next: ModelSelection = {
        instanceId,
        model,
        options: [{ id: "effort", value: "high" }],
      };
      store.setModelSelection(draftId, next, { explicit: true, replaceOptions: true });
    };
    return (
      <>
        <span>{routing.needsLoadBalancing ? "Routing" : `Ready on ${draft?.environmentId}`}</span>
        <ProviderModelPicker
          environmentId={null}
          activeInstanceId={selection?.instanceId ?? remoteInstance}
          model={selection?.model ?? ""}
          lockedProvider={null}
          instanceEntries={entries}
          modelOptionsByInstance={
            new Map(
              entries.map((entry) => [
                entry.instanceId,
                getAppModelOptionsForInstance(DEFAULT_UNIFIED_SETTINGS, entry),
              ]),
            )
          }
          onInstanceModelChange={change}
        />
      </>
    );
  }
  const registry = AtomRegistry.make();
  using _registry = {
    [Symbol.dispose]() {
      registry.dispose();
    },
  };
  await using screen = await render(
    <RegistryContext.Provider value={registry}>
      <Draft />
    </RegistryContext.Provider>,
  );
  await expect.element(screen.getByText("Ready on a")).toBeInTheDocument();
  await screen.getByRole("button", { name: "Kimi", exact: true }).click();
  const { page } = await import("vite-plus/test/browser");
  await page.getByRole("button", { name: "Remote OpenCode", exact: true }).click();
  await page.getByRole("option", { name: /DeepSeek/ }).click();
  await expect.element(screen.getByText("Ready on b")).toBeInTheDocument();
  expect(useComposerDraftStore.getState().getComposerDraft(draftId)).toMatchObject({
    prompt: "keep my draft",
    activeProvider: remoteInstance,
    modelSelectionByProvider: {
      [remoteInstance]: { model: "deepseek/chat", options: [{ id: "effort", value: "high" }] },
    },
  });
  await act(() =>
    useComposerDraftStore.getState().setDraftThreadContext(draftId, {
      projectRef: scopeProjectRef(a, projectA),
      environmentSelection: "manual",
      loadBalancedEnvironmentId: null,
    }),
  );
  await expect.element(screen.getByText("Ready on a")).toBeInTheDocument();
});
