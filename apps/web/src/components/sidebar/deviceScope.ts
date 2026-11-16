import type { SidebarDeviceGroup } from "../../sidebarPersonalization";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";

export function sidebarDeviceActivity(
  threads: readonly Pick<EnvironmentThreadShell, "environmentId" | "runtime">[],
) {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    if (threadRuntimeIsActive(thread.runtime)) {
      counts.set(thread.environmentId, (counts.get(thread.environmentId) ?? 0) + 1);
    }
  }
  return counts;
}

export function sidebarDeviceScopeIds(
  value: string | null,
  groups: readonly SidebarDeviceGroup[],
): ReadonlySet<string> | null {
  if (value === null) return null;
  if (!value.startsWith("group:")) return new Set([value]);
  return new Set(
    groups
      .find((group) => `group:${group.id}` === value)
      ?.members.map((member) => member.environmentId) ?? [],
  );
}

export function sidebarDeviceProjectScope(
  projects: readonly { environmentId: string; id: string }[],
  projectKeys: ReadonlySet<string> | null,
  environmentIds: ReadonlySet<string> | null,
): ReadonlySet<string> | null {
  if (environmentIds === null) return projectKeys;
  return new Set(
    projects.flatMap((project) => {
      const key = `${project.environmentId}:${project.id}`;
      return environmentIds.has(project.environmentId) &&
        (projectKeys === null || projectKeys.has(key))
        ? [key]
        : [];
    }),
  );
}
