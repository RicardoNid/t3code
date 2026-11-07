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

export function sidebarDeviceProjectScope(
  projects: readonly { environmentId: string; id: string }[],
  projectKeys: ReadonlySet<string> | null,
  environmentId: string | null,
): ReadonlySet<string> | null {
  if (environmentId === null) return projectKeys;
  return new Set(
    projects.flatMap((project) => {
      const key = `${project.environmentId}:${project.id}`;
      return project.environmentId === environmentId &&
        (projectKeys === null || projectKeys.has(key))
        ? [key]
        : [];
    }),
  );
}
