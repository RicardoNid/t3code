import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import {
  sidebarDeviceActivity,
  sidebarDeviceProjectScope,
  sidebarDeviceScopeIds,
} from "./deviceScope";

describe("device scope", () => {
  it("intersects project scopes without broadening an empty or unavailable device", () => {
    const projects = [
      { environmentId: "ltr-dev", id: "shared-id" },
      { environmentId: "macbook", id: "shared-id" },
      { environmentId: "macbook", id: "other" },
    ];
    const projectKeys = new Set(["ltr-dev:shared-id", "macbook:shared-id"]);
    expect(sidebarDeviceProjectScope(projects, projectKeys, null)).toBe(projectKeys);
    expect(sidebarDeviceProjectScope(projects, null, null)).toBeNull();
    expect([...sidebarDeviceProjectScope(projects, null, new Set(["macbook"]))!]).toEqual([
      "macbook:shared-id",
      "macbook:other",
    ]);
    expect([...sidebarDeviceProjectScope(projects, projectKeys, new Set(["macbook"]))!]).toEqual([
      "macbook:shared-id",
    ]);
    expect([
      ...sidebarDeviceProjectScope(projects, new Set(["ltr-dev:shared-id"]), new Set(["macbook"]))!,
    ]).toEqual([]);
    expect([...sidebarDeviceProjectScope(projects, null, new Set(["removed"]))!]).toEqual([]);
  });

  it("resolves device groups without including unrelated devices or widening missing groups", () => {
    const groups = [
      {
        id: "mine",
        name: "My devices",
        members: [
          { environmentId: "ltr-dev", label: "LTR-DEV" },
          { environmentId: "macbook", label: "MacBook" },
          { environmentId: "offline", label: "Offline host" },
        ],
      },
      { id: "empty", name: "New group", members: [] },
    ];
    expect(sidebarDeviceScopeIds(null, groups)).toBeNull();
    expect([...sidebarDeviceScopeIds("macbook", groups)!]).toEqual(["macbook"]);
    expect([...sidebarDeviceScopeIds("group:mine", groups)!]).toEqual([
      "ltr-dev",
      "macbook",
      "offline",
    ]);
    expect([...sidebarDeviceScopeIds("group:missing", groups)!]).toEqual([]);
    expect([...sidebarDeviceScopeIds("group:empty", groups)!]).toEqual([]);
    const projects = [
      { environmentId: "ltr-dev", id: "shared" },
      { environmentId: "macbook", id: "shared" },
      { environmentId: "someone-else", id: "shared" },
    ];
    expect([
      ...sidebarDeviceProjectScope(
        projects,
        new Set(["macbook:shared", "someone-else:shared"]),
        sidebarDeviceScopeIds("group:mine", groups),
      )!,
    ]).toEqual(["macbook:shared"]);
    expect([
      ...sidebarDeviceProjectScope(projects, null, sidebarDeviceScopeIds("group:missing", groups))!,
    ]).toEqual([]);
  });

  it("counts in-flight work by environment, including queued and blocked turns", () => {
    const runtime = (
      status: "preparing" | "queued" | "starting" | "running" | "waiting" | "idle" | "failed",
    ) => ({
      status,
      activeRunId: null,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: "Codex",
      lastError: null,
      updatedAt: "2026-11-06T00:00:00.000Z",
    });
    const ltr = EnvironmentId.make("ltr-dev");
    const mac = EnvironmentId.make("macbook");
    const threads = [
      ...(["preparing", "queued", "starting", "running", "waiting", "idle", "failed"] as const).map(
        (status) => ({ environmentId: ltr, runtime: runtime(status) }),
      ),
      { environmentId: mac, runtime: runtime("running") },
      { environmentId: mac, runtime: null },
    ];
    expect([...sidebarDeviceActivity(threads)]).toEqual([
      [ltr, 5],
      [mac, 1],
    ]);
  });
});
