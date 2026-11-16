import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { useProjects, useQuietThreadShells } from "../state/entities";
import { makeThreadFixture } from "../test-fixtures";
import type { Project } from "../types";
import Sidebar from "./Sidebar";
import { resolveSidebarReorderableThreadKeys } from "./Sidebar.logic";
import { useEnvironmentScope } from "../state/session";
import { useConnectedEnvironmentIds, useEnvironmentIdentities } from "../state/environments";
vi.mock("../state/environments", { spy: true });
import { THREAD_CONTEXT_DROP_EVENT } from "./chat/threadContextDrag";
vi.mock("./Sidebar.logic", { spy: true });
vi.mock("../state/session", { spy: true });
import { PersonalSidebarGroupHeader } from "./sidebar/PersonalSidebarGroupHeader";
import { useUiStateStore } from "../uiStateStore";
import { SidebarProvider } from "./ui/sidebar";

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../commandPaletteBus", () => ({
  openCommandPalette: vi.fn(),
  isCommandPaletteOpen: () => false,
}));
vi.mock("./sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

function project(id: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId: EnvironmentId.make("local"),
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("sidebar header new thread", () => {
  it.each([
    { mode: "normal", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: true, picker: false },
    { mode: "boring", count: 1, shift: false, picker: false },
    { mode: "legacy", count: 2, shift: false, picker: false },
  ] as const)("$mode sidebar, $count projects, shift=$shift: picker=$picker", async (scenario) => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: scenario.mode === "boring",
      legacySidebarEnabled: scenario.mode === "legacy",
    });
    const projects = [project("active"), project("idle")].slice(0, scenario.count);
    const currentProjectRef = {
      environmentId: projects[0]!.environmentId,
      projectId: projects[0]!.id,
    };
    const startThread = vi.fn().mockResolvedValue(null);
    vi.mocked(useProjects).mockReturnValue(projects);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: currentProjectRef,
      handleNewThread: startThread,
      routeDraftId: null,
      routeThreadRef: null,
    });
    vi.mocked(openCommandPalette).mockClear();
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "New thread", exact: true }), {
      modifiers: scenario.shift ? ["Shift"] : [],
    });

    if (scenario.picker) {
      expect(openCommandPalette).toHaveBeenCalledExactlyOnceWith({ open: "new-thread-in" });
      expect(startThread).not.toHaveBeenCalled();
    } else {
      expect(openCommandPalette).not.toHaveBeenCalled();
      expect(startThread).toHaveBeenCalledExactlyOnceWith(currentProjectRef);
    }
  });
});

it("groups only Inbox threads and keeps membership across working transitions", async () => {
  using cleanup = new DisposableStack();
  vi.mocked(useEnvironmentScope).mockReturnValue(true);
  cleanup.defer(() => vi.mocked(useEnvironmentScope).mockRestore());
  vi.mocked(resolveSidebarReorderableThreadKeys).mockReturnValue({
    draggableThreadKeys: new Set(["local:das", "local:other"]),
    activeReorderableThreadKeys: new Set(["local:das", "local:other"]),
  });
  cleanup.defer(() => vi.mocked(resolveSidebarReorderableThreadKeys).mockRestore());
  const key = "t3code:personal-sidebar:v1";
  const previous = localStorage.getItem(key);
  cleanup.defer(() => {
    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
  });
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      view: "groups",
      modelIcons: "both",
      deviceIcons: {},
      ungroupedCollapsed: false,
      groups: [
        {
          id: "planning",
          name: "Scheduling",
          collapsed: false,
          members: [
            { key: "local:das", title: "DAS schedule" },
            { key: "offline:long-lived", title: "Remote planning" },
          ],
        },
      ],
    }),
  );
  const projects = [project("active")];
  vi.mocked(useProjects).mockReturnValue(projects);
  vi.mocked(useQuietThreadShells).mockReturnValue([
    makeThreadFixture({
      id: ThreadId.make("das"),
      environmentId: EnvironmentId.make("local"),
      projectId: projects[0]!.id,
      title: "DAS schedule",
    }),
    makeThreadFixture({
      id: ThreadId.make("other"),
      environmentId: EnvironmentId.make("local"),
      projectId: projects[0]!.id,
      title: "Unsorted task",
    }),
  ]);
  cleanup.defer(() => vi.mocked(useQuietThreadShells).mockRestore());
  vi.mocked(useHandleNewThread).mockReturnValue({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: null,
    handleNewThread: vi.fn(),
    routeDraftId: null,
    routeThreadRef: null,
  });
  await using screen = await render(
    <SidebarProvider>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>,
  );
  await expect.element(screen.getByRole("button", { name: /^DAS schedule, / })).toBeVisible();
  await expect
    .element(screen.getByText("Remote planning", { exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Ungrouped", exact: true }))
    .not.toBeInTheDocument();
  const target = document.createElement("div");
  target.setAttribute("data-thread-context-drop", "true");
  Object.assign(target.style, {
    position: "fixed",
    right: "0",
    top: "0",
    width: "100px",
    height: "100px",
    zIndex: "99999",
  });
  document.body.append(target);
  cleanup.defer(() => target.remove());
  const dropped = vi.fn();
  target.addEventListener(THREAD_CONTEXT_DROP_EVENT, dropped);
  screen.container.style.width = "250px";
  const row = screen.container.querySelector<HTMLElement>('[data-sidebar-row="local:das"]')!;
  const rect = row.getBoundingClientRect();
  const destination = target.getBoundingClientRect();
  const pointer = {
    pointerId: 91,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 1,
    bubbles: true,
  };
  await act(() =>
    row.dispatchEvent(
      new PointerEvent("pointerdown", {
        ...pointer,
        clientX: rect.left + 30,
        clientY: rect.top + 20,
      }),
    ),
  );
  await act(() =>
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        ...pointer,
        clientX: destination.left + 20,
        clientY: destination.top + 20,
      }),
    ),
  );
  await expect.element(target).toHaveAttribute("data-thread-context-over", "true");
  await act(() =>
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        ...pointer,
        buttons: 0,
        clientX: destination.left + 20,
        clientY: destination.top + 20,
      }),
    ),
  );
  expect(dropped.mock.calls[0]?.[0].detail).toEqual([{ environmentId: "local", threadId: "das" }]);
  target.remove();
  const group = screen.getByRole("button", { name: /Scheduling/ });
  await userEvent.click(group);
  await expect.element(group).toHaveAttribute("aria-expanded", "false");
  await expect
    .element(screen.getByRole("button", { name: /^DAS schedule, / }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Unsorted task, active", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Status", exact: true }))
    .not.toBeInTheDocument();
  await userEvent.click(group);
  const initialThreads = vi.mocked(useQuietThreadShells)();
  vi.mocked(useQuietThreadShells).mockReturnValue(
    initialThreads.map((thread) =>
      thread.id === "das"
        ? {
            ...thread,
            runtime: {
              status: "running",
              activeRunId: null,
              providerInstanceId: ProviderInstanceId.make("codex"),
              providerName: "Codex",
              lastError: null,
              updatedAt: "2026-11-05T00:00:00.000Z",
            },
          }
        : thread,
    ),
  );
  await screen.rerender(
    <SidebarProvider>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>,
  );
  await expect
    .element(screen.getByRole("button", { name: /^DAS schedule, / }))
    .not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(key)!).groups[0].members[0].key).toBe("local:das");
  vi.mocked(useQuietThreadShells).mockReturnValue(
    initialThreads.map((thread) =>
      thread.id === "das" ? { ...thread, hasPendingUserInput: true } : thread,
    ),
  );
  await screen.rerender(
    <SidebarProvider>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>,
  );
  await expect.element(screen.getByRole("button", { name: /^DAS schedule, / })).toBeVisible();
  await userEvent.click(group);
  await expect
    .element(screen.getByRole("button", { name: /^DAS schedule, / }))
    .not.toBeInTheDocument();
  vi.mocked(useQuietThreadShells).mockReturnValue(
    initialThreads.map((thread) =>
      thread.id === "das"
        ? { ...thread, settledOverride: "settled", settledAt: "2026-11-11T12:00:00.000Z" }
        : thread,
    ),
  );
  await screen.rerender(
    <SidebarProvider>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>,
  );
  await vi.waitFor(() =>
    expect(JSON.parse(localStorage.getItem(key)!).groups[0].members).toEqual([
      { key: "offline:long-lived", title: "Remote planning" },
    ]),
  );
  vi.mocked(useQuietThreadShells).mockReturnValue(initialThreads);
  await screen.rerender(
    <SidebarProvider>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>,
  );
  await expect.element(screen.getByRole("button", { name: /^DAS schedule, / })).toBeVisible();
  expect(JSON.parse(localStorage.getItem(key)!).groups[0].members).toEqual([
    { key: "offline:long-lived", title: "Remote planning" },
  ]);
});

it("clears a group's completion badge when a legacy local visit advances", async () => {
  using cleanup = new DisposableStack();
  const previous = useUiStateStore.getState().threadLastVisitedAtById;
  cleanup.defer(() => useUiStateStore.setState({ threadLastVisitedAtById: previous }));
  useUiStateStore.setState({
    threadLastVisitedAtById: { "local:done": "2026-01-01T10:00:00.000Z" },
  });
  const { lastVisitedAt: _lastVisitedAt, ...done } = makeThreadFixture({
    id: ThreadId.make("done"),
    runtime: null,
    environmentId: EnvironmentId.make("local"),
    latestRun: {
      runId: RunId.make("run-done"),
      status: "completed",
      assistantMessageId: null,
      requestedAt: "2026-01-01T10:00:00.000Z",
      startedAt: "2026-01-01T10:00:00.000Z",
      completedAt: "2026-01-01T10:01:00.000Z",
    },
  });
  await using screen = await render(
    <ul>
      <PersonalSidebarGroupHeader
        id="planning"
        name="Planning"
        collapsed
        threads={[done]}
        onToggle={() => {}}
      />
    </ul>,
  );
  await expect.element(screen.getByLabelText("1 unread completions")).toBeVisible();
  await expect.element(screen.getByText("unread", { exact: true })).toBeVisible();
  useUiStateStore.getState().markThreadVisited("local:done", "2026-01-01T10:02:00.000Z");
  await expect.element(screen.getByLabelText("1 unread completions")).not.toBeInTheDocument();
  await expect.element(screen.getByText("unread", { exact: true })).not.toBeInTheDocument();
});

it("filters sessions across projects by their server environment and preserves unavailable scope", async () => {
  using cleanup = new DisposableStack();
  const preferencesKey = "t3code:personal-sidebar:v1";
  const previousPreferences = localStorage.getItem(preferencesKey);
  localStorage.setItem(
    preferencesKey,
    JSON.stringify({
      version: 1,
      view: "status",
      modelIcons: "both",
      groups: [],
      ungroupedCollapsed: false,
      deviceIcons: {},
      deviceGroups: [
        {
          id: "mine",
          name: "My devices",
          members: [
            { environmentId: "local", label: "LTR-DEV" },
            { environmentId: "macbook", label: "MacBook" },
          ],
        },
      ],
    }),
  );
  cleanup.defer(() => {
    if (previousPreferences === null) localStorage.removeItem(preferencesKey);
    else localStorage.setItem(preferencesKey, previousPreferences);
  });
  const key = "t3code:sidebar-device-scope:v1";
  const previous = localStorage.getItem(key);
  localStorage.removeItem(key);
  cleanup.defer(() => {
    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
  });
  const previousScope = useUiStateStore.getState().sidebarProjectScopeKeys;
  useUiStateStore.getState().setSidebarProjectScopeKeys([]);
  cleanup.defer(() => useUiStateStore.getState().setSidebarProjectScopeKeys(previousScope));
  const local = EnvironmentId.make("local");
  const remote = EnvironmentId.make("macbook");
  vi.mocked(useEnvironmentIdentities).mockReturnValue([
    { environmentId: local, label: "LTR-DEV" },
    { environmentId: remote, label: "MacBook" },
  ]);
  vi.mocked(useConnectedEnvironmentIds).mockReturnValue([local]);
  cleanup.defer(() => {
    vi.mocked(useEnvironmentIdentities).mockRestore();
    vi.mocked(useConnectedEnvironmentIds).mockRestore();
  });
  const projects = [
    project("local-project"),
    { ...project("remote-project"), environmentId: remote },
    { ...project("remote-sibling-project"), environmentId: remote },
  ];
  vi.mocked(useProjects).mockReturnValue(projects);
  vi.mocked(useQuietThreadShells).mockReturnValue(
    projects.map((entry, index) =>
      makeThreadFixture({
        environmentId: entry.environmentId,
        projectId: entry.id,
        id: ThreadId.make(`device-session-${index}`),
        title: ["Local session", "Remote session", "Remote sibling session"][index]!,
      }),
    ),
  );
  cleanup.defer(() => {
    vi.mocked(useProjects).mockRestore();
    vi.mocked(useQuietThreadShells).mockRestore();
  });
  vi.mocked(useHandleNewThread).mockReturnValue({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: null,
    handleNewThread: vi.fn(),
    routeDraftId: null,
    routeThreadRef: null,
  });
  cleanup.defer(() => vi.mocked(useHandleNewThread).mockRestore());
  await using screen = await render(
    <SidebarProvider>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>,
  );
  await expect.element(screen.getByRole("button", { name: /^Local session, / })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /^Remote session, / })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Remote sibling session, / }))
    .toBeVisible();
  await userEvent.click(screen.getByRole("combobox", { name: "Filter threads by device" }));
  await expect.element(screen.getByRole("option", { name: /^LTR-DEV/ })).not.toBeInTheDocument();
  await expect.element(screen.getByRole("option", { name: /^MacBook/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("option", { name: /^My devices/ }));
  await expect.element(screen.getByRole("button", { name: /^Local session, / })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Remote sibling session, / }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("status", { name: "Device activity" }))
    .toHaveTextContent(
      "2 devices · 0 active · 2 activity unknown. Across all projects, including subagents.",
    );
  expect(JSON.parse(localStorage.getItem(key)!)).toMatch(/^group:/);
  await userEvent.click(
    screen.getByRole("combobox", { name: "Filter threads by project", exact: true }),
  );
  await userEvent.click(screen.getByRole("option", { name: /local-project/ }));
  await expect.element(screen.getByRole("button", { name: /^Local session, / })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Remote session, / }))
    .not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("combobox", { name: /Filter threads by project:/ }));
  await userEvent.click(screen.getByRole("option", { name: "All projects", exact: true }));
  await userEvent.click(screen.getByRole("combobox", { name: "Filter threads by device" }));
  await userEvent.click(screen.getByRole("option", { name: "All devices", exact: true }));
  localStorage.setItem(
    preferencesKey,
    JSON.stringify({
      ...JSON.parse(localStorage.getItem(preferencesKey)!),
      deviceGroups: [],
    }),
  );
  window.dispatchEvent(new StorageEvent("storage", { key: preferencesKey }));
  await userEvent.click(screen.getByRole("combobox", { name: "Filter threads by device" }));
  await userEvent.click(screen.getByRole("option", { name: /MacBook/ }));
  await expect.element(screen.getByRole("button", { name: /^Remote session, / })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Remote sibling session, / }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Local session, / }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("status", { name: "Device activity" }))
    .toHaveTextContent(
      "Disconnected · activity unknown. Across all projects, including subagents.",
    );
  expect(JSON.parse(localStorage.getItem(key)!)).toBe("macbook");
  await userEvent.click(
    screen.getByRole("combobox", { name: "Filter threads by project", exact: true }),
  );
  await userEvent.click(screen.getByRole("option", { name: /local-project/ }));
  await expect
    .element(screen.getByRole("button", { name: /^Remote session, / }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: /^Local session, / }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: /^Remote sibling session, / }))
    .not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(key)!)).toBe("macbook");
  await userEvent.click(screen.getByRole("combobox", { name: /Filter threads by project:/ }));
  await userEvent.click(screen.getByRole("option", { name: "All projects", exact: true }));
  await expect.element(screen.getByRole("button", { name: /^Remote session, / })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Remote sibling session, / }))
    .toBeVisible();

  vi.mocked(useEnvironmentIdentities).mockReturnValue([{ environmentId: local, label: "LTR-DEV" }]);
  await screen.rerender(
    <SidebarProvider>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>,
  );
  await expect
    .element(screen.getByRole("combobox", { name: "Filter threads by device" }))
    .toHaveTextContent("Unavailable device");
  await expect
    .element(screen.getByRole("button", { name: /^Local session, / }))
    .not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("combobox", { name: "Filter threads by device" }));
  await userEvent.click(screen.getByRole("option", { name: "All devices", exact: true }));
  await expect.element(screen.getByRole("button", { name: /^Local session, / })).toBeVisible();
});
