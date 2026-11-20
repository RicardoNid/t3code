import appCss from "../index.css?inline";
import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import * as shelfHooks from "../state/olderSettledShelf";
import { createWorkspaceFocusController, workspaceAreaProps } from "../lib/workspaceFocus";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  type LocalApi,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { makeThreadFixture } from "../test-fixtures";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useNowMinute } from "../hooks/useNowMinute";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useProjects, useServerConfigs, useQuietThreadShells } from "../state/entities";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { readLocalApi } from "../localApi";
import type { Project } from "../types";
import Sidebar from "./Sidebar";
import {
  THREAD_JUMP_HINT_SHOW_DELAY_MS,
  resolveSidebarReorderableThreadKeys,
} from "./Sidebar.logic";
import { SortableThreadRow } from "./sidebar/SidebarThreadRow";
import { useConnectedEnvironmentIds, useEnvironmentIdentities } from "../state/environments";
vi.mock("../state/environments", { spy: true });
import { THREAD_CONTEXT_DROP_EVENT } from "./chat/threadContextDrag";
vi.mock("./Sidebar.logic", { spy: true });
import { PersonalSidebarGroupHeader } from "./sidebar/PersonalSidebarGroupHeader";
import { useUiStateStore } from "../uiStateStore";
import { SidebarProvider } from "./ui/sidebar";

vi.mock(import("../state/olderSettledShelf"), async (original) => {
  const actual = await original();
  return { ...actual, useOlderSettledShelf: vi.fn(actual.useOlderSettledShelf) };
});
vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../hooks/useNowMinute", { spy: true });
vi.mock("../hooks/useThreadRouteTarget", { spy: true });
vi.mock("./sidebar/SidebarThreadRow", { spy: true });
vi.mock("../state/session", { spy: true });
vi.mock("../state/use-orchestration-command", { spy: true });
vi.mock("../localApi", { spy: true });
vi.mock(import("../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  // The desktop defaults: holding Mod alone already matches a thread jump.
  const keybindings = compileResolvedKeybindingsConfig([
    { key: "mod+1", command: "thread.jump.1" },
    { key: "mod+2", command: "thread.jump.2" },
  ]);
  return { ...(await original()), primaryServerKeybindingsAtom: Atom.make(keybindings) };
});
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
  ] as const)("$mode sidebar, $count projects, shift=$shift: picker=$picker", async (scenario) => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: scenario.mode === "boring",
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
      defaultProjectFallbackReady: true,
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
    defaultProjectFallbackReady: true,
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
    defaultProjectFallbackReady: true,
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

function threadShell(projectId: ProjectId, index: number): EnvironmentThreadShell {
  return makeThreadFixture({
    environmentId: EnvironmentId.make("local"),
    id: ThreadId.make(`thread-${index}`),
    projectId,
    title: `Thread ${index}`,
  });
}

describe("sidebar render isolation", () => {
  // regression: #33100 Cmd+J re-rendered every sidebar row, which took hundreds of ms with many threads
  it("does not re-render thread rows when a quick Mod shortcut opens and focuses the terminal", async () => {
    using stack = new DisposableStack();
    const activeProject = project("active");
    const threads = Array.from({ length: 5 }, (_, index) => threadShell(activeProject.id, index));
    const routeThreadRef: ScopedThreadRef = {
      environmentId: activeProject.environmentId,
      threadId: threads[0]!.id,
    };
    threads.unshift(threadShell(activeProject.id, 100));
    // A real wall-clock minute tick mid-test re-renders every row and reads as a leak.
    vi.mocked(useNowMinute).mockReturnValue("2026-01-01T00:00");
    vi.mocked(useProjects).mockReturnValue([activeProject]);
    vi.mocked(useQuietThreadShells).mockReturnValue(threads);
    vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef: routeThreadRef });
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: {
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
      },
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef,
    });
    const terminal = document.createElement("div");
    terminal.dataset.terminalOwner = "drawer";
    const terminalInput = document.createElement("textarea");
    terminal.append(terminalInput);
    document.body.append(terminal);
    stack.defer(() => terminal.remove());
    stack.defer(() => useTerminalUiStateStore.getState().setTerminalOpen(routeThreadRef, false));
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    await expect.element(screen.getByText("Thread 4").first()).toBeInTheDocument();
    const rowRenders = () => vi.mocked(SortableThreadRow).mock.calls.length;

    using _timers = fakeTimers();
    const modifier = isMacPlatform(navigator.platform) ? "Meta" : "Control";
    const beforeShortcut = rowRenders();
    await userEvent.keyboard(`{${modifier}>}`);
    await act(() => useTerminalUiStateStore.getState().setTerminalOpen(routeThreadRef, true));
    await act(() => terminalInput.focus());
    await userEvent.keyboard(`{/${modifier}}`);
    await act(() => terminalInput.blur());
    expect(
      rowRenders() - beforeShortcut,
      "thread rows re-rendered while opening the terminal with a quick Mod shortcut",
    ).toBe(0);

    const jumpLabelsSince = (start: number) =>
      vi
        .mocked(SortableThreadRow)
        .mock.calls.slice(start)
        .map(([props]) => props.jumpLabel)
        .filter((label) => label !== null);
    const beforeHold = rowRenders();
    await userEvent.keyboard(`{${modifier}>}`);
    await act(() => vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS));
    expect(jumpLabelsSince(beforeHold), "holding Mod showed no jump hints").toHaveLength(2);
    const beforeRelease = rowRenders();
    await userEvent.keyboard(`{/${modifier}}`);
    expect(rowRenders()).toBeGreaterThan(beforeRelease);
    expect(jumpLabelsSince(beforeRelease)).toEqual([]);
  });
});

describe("sidebar thread rename", () => {
  // regression: #35151 an untouched rename wrote back the title it opened with over a newer one
  it.each(["{Enter}", "{Tab}"])(
    "ending an untouched rename with %s keeps a title that arrived while it was open",
    async (finish) => {
      const activeProject = project("active");
      const routeThreadRef: ScopedThreadRef = {
        environmentId: activeProject.environmentId,
        threadId: ThreadId.make("thread-0"),
      };
      const shellTitled = (title: string) => ({ ...threadShell(activeProject.id, 0), title });
      const updateMetadata = vi.fn().mockResolvedValue({ _tag: "Success" });
      vi.mocked(useOrchestrationCommand).mockReturnValue(updateMetadata);
      vi.mocked(readEnvironmentScope).mockReturnValue(true);
      vi.mocked(useEnvironmentScope).mockReturnValue(true);
      vi.mocked(useProjects).mockReturnValue([activeProject]);
      vi.mocked(useQuietThreadShells).mockReturnValue([shellTitled("Fix the login redirect")]);
      vi.mocked(useThreadRouteTarget).mockReturnValue({
        kind: "server",
        threadRef: routeThreadRef,
      });
      vi.mocked(useHandleNewThread).mockReturnValue({
        activeDraftThread: null,
        activeThread: null,
        defaultProjectRef: {
          environmentId: activeProject.environmentId,
          projectId: activeProject.id,
        },
        defaultProjectFallbackReady: true,
        handleNewThread: vi.fn().mockResolvedValue(null),
        routeDraftId: null,
        routeThreadRef,
      });
      const tree = () => (
        <SidebarProvider>
          <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
        </SidebarProvider>
      );
      await using screen = await render(tree());
      await userEvent.dblClick(screen.getByText("Fix the login redirect").first());
      const input = screen.getByRole("textbox", { name: "Thread title" });
      await expect.element(input).toHaveValue("Fix the login redirect");

      vi.mocked(useQuietThreadShells).mockReturnValue([shellTitled("Generated title")]);
      await screen.rerender(tree());
      await userEvent.keyboard(finish);

      await expect.element(input).not.toBeInTheDocument();
      expect(updateMetadata).not.toHaveBeenCalled();
    },
  );
});

describe("sidebar thread menu", () => {
  it("tells the menu whether the keyboard opened it", async () => {
    const activeProject = project("active");
    const thread = threadShell(activeProject.id, 0);
    const threadRef = { environmentId: activeProject.environmentId, threadId: thread.id };
    const show = vi.fn().mockResolvedValue(null);
    vi.mocked(readLocalApi).mockReturnValue({ contextMenu: { show } } as unknown as LocalApi);
    vi.mocked(useProjects).mockReturnValue([activeProject]);
    vi.mocked(useQuietThreadShells).mockReturnValue([thread]);
    vi.mocked(useThreadRouteTarget).mockReturnValue({ kind: "server", threadRef });
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: {
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
      },
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef: threadRef,
    });
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    const row = screen.getByText("Thread 0").first();
    await expect.element(row).toBeInTheDocument();
    row.element().closest<HTMLElement>("[data-sidebar-row]")!.focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    expect(show.mock.lastCall?.[2]).toBe("keyboard");
    await userEvent.click(row, { button: "right" });
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(2));
    expect(show.mock.lastCall?.[2]).toBe("mouse");
  });
});

describe("sidebar settled pagination", () => {
  it("keeps the viewport in place when showing more settled threads", async () => {
    using stack = new DisposableStack();
    const style = document.createElement("style");
    style.textContent = appCss;
    document.head.append(style);
    stack.defer(() => style.remove());
    const focusController = createWorkspaceFocusController(document);
    stack.defer(() => focusController.dispose());
    let loading = false;
    const originalShelf = vi.mocked(shelfHooks.useOlderSettledShelf).getMockImplementation()!;
    using _shelf = vi.spyOn(shelfHooks, "useOlderSettledShelf").mockImplementation((input) => ({
      ...originalShelf(input),
      loading,
      retry: () => {
        loading = true;
      },
    }));
    const activeProject = project("active");
    const threads = Array.from({ length: 70 }, (_, index) =>
      makeThreadFixture({
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
        id: ThreadId.make(`settled-${index}`),
        title: `Settled thread ${index}`,
        settledOverride: "settled",
        settledAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    threads.unshift(threadShell(activeProject.id, 100));
    vi.mocked(useProjects).mockReturnValue([activeProject]);
    vi.mocked(useQuietThreadShells).mockReturnValue(threads);
    vi.mocked(useThreadRouteTarget).mockReturnValue({
      kind: "server",
      threadRef: { environmentId: activeProject.environmentId, threadId: threads[0]!.id },
    });
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: {
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
      },
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef: { environmentId: activeProject.environmentId, threadId: threads[0]!.id },
    });
    vi.mocked(useServerConfigs).mockReturnValue(
      new Map([
        [
          activeProject.environmentId,
          {
            scratchWorkspaceRoot: null,
            shellThreadFamilies: false,
          } as unknown as EnvironmentServerConfig,
        ],
      ]),
    );
    await using screen = await render(
      <SidebarProvider
        {...workspaceAreaProps("sidebar", 0, "Threads")}
        style={{ height: 400, minHeight: 400 }}
      >
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    const shelf = screen.container.querySelector<HTMLElement>(
      '[data-sidebar-row="shelf:settled"]',
    )!;
    if (shelf.getAttribute("aria-expanded") === "false") await act(() => shelf.click());
    const more = screen.getByRole("button", { name: "Show 25 more", exact: true });
    await expect.element(more).toBeInTheDocument();
    const moreButton = more.element() as HTMLButtonElement;
    const viewport = moreButton.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    viewport.style.height = "300px";
    viewport.style.maxHeight = "300px";
    moreButton.scrollIntoView({ block: "nearest" });
    const before = viewport.scrollTop;
    expect(before).toBeGreaterThan(0);
    moreButton.focus({ preventScroll: true });
    await act(() => moreButton.click());
    await expect
      .element(screen.getByRole("button", { name: "Loading", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Loading", exact: true }))
      .toHaveFocus();
    expect(viewport.scrollTop).toBe(before);
    const loadedRows = screen.container.querySelectorAll("[data-thread-item]").length;
    await act(() => moreButton.click());
    expect(screen.container.querySelectorAll("[data-thread-item]")).toHaveLength(loadedRows);
  });
});
