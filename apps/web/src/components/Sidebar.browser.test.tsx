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

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { useProjects, useQuietThreadShells } from "../state/entities";
import { makeThreadFixture } from "../test-fixtures";
import type { Project } from "../types";
import Sidebar from "./Sidebar";
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
