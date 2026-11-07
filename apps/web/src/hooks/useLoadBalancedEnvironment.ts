import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  chooseLoadBalancedProvider,
  supportsLoadBalancedSelection,
  type LoadBalancingCandidate,
} from "@t3tools/client-runtime/load-balancing";
import type { EnvironmentId, ModelSelection, ProviderDriverKind } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useContext } from "react";

import { serverEnvironment } from "../state/server";

// Mirrors the freshness window in chooseLoadBalancedEnvironment.
const HOST_RESOURCES_FRESH_MS = 15_000;

// Keyed by content: callers derive the list every render.
const hostResourcesAtom = Atom.family((environmentIdsKey: string) =>
  Atom.make((get) => {
    const evaluatedAt = Date.now();
    const resources = (
      environmentIdsKey === "" ? [] : (environmentIdsKey.split("\n") as EnvironmentId[])
    ).map((environmentId) => {
      const result = get(serverEnvironment.hostResources({ environmentId, input: {} }));
      return {
        environmentId,
        resources: result._tag === "Success" ? result.value : null,
        receivedAt: result._tag === "Success" ? result.timestamp : 0,
        pending: result._tag === "Initial" || result.waiting,
        failed: result._tag === "Failure",
      };
    });
    // Re-read when the next fresh snapshot ages out, so a frozen evaluatedAt never selects it.
    const nextExpiry = Math.min(
      ...resources
        .map((resource) => resource.receivedAt + HOST_RESOURCES_FRESH_MS)
        .filter((expiresAt) => expiresAt >= evaluatedAt),
    );
    if (Number.isFinite(nextExpiry)) {
      const timer = setTimeout(() => get.refreshSelf(), nextExpiry - evaluatedAt + 1);
      get.addFinalizer(() => clearTimeout(timer));
    }
    return { evaluatedAt, resources };
  }),
);

/** Only mounted for unresolved automatic drafts, so idle clients do not poll hosts. */
export function useLoadBalancedEnvironment(
  candidates: readonly Omit<LoadBalancingCandidate, "resources" | "receivedAt">[],
  selection: ModelSelection | null,
  driver: ProviderDriverKind,
  strategy: "hardware" | "usage",
  capacities: Readonly<Record<string, number>>,
) {
  const registry = useContext(RegistryContext);
  const matching = selection
    ? candidates.filter((candidate) =>
        supportsLoadBalancedSelection(candidate.provider, driver, selection),
      )
    : [];
  const environmentIds = [...new Set(matching.map((candidate) => candidate.environmentId))];
  const refresh = (ids: readonly EnvironmentId[]) => {
    for (const environmentId of ids) {
      registry.refresh(serverEnvironment.hostResources({ environmentId, input: {} }));
    }
  };
  const { evaluatedAt, resources } = useAtomValue(hostResourcesAtom(environmentIds.join("\n")));
  const pending = resources.some((resource) => resource.pending);
  const selected = selection
    ? chooseLoadBalancedProvider({
        candidates: matching.map((candidate) => {
          const resource = resources.find(
            (resource) => resource.environmentId === candidate.environmentId,
          );
          return {
            ...candidate,
            resources: resource?.resources ?? null,
            receivedAt: resource?.receivedAt ?? 0,
          };
        }),
        selection,
        driver,
        strategy,
        capacities,
        now: evaluatedAt,
      })
    : null;
  const environmentId = (selected?.environmentId ?? null) as EnvironmentId | null;
  return {
    refresh,
    pending,
    environmentId,
    instanceId: selected?.instanceId ?? null,
    failed: !pending && environmentId === null,
  };
}
