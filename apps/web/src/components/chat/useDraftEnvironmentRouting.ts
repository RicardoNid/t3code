import { useLoadBalancedEnvironment } from "../../hooks/useLoadBalancedEnvironment";
import { useLogicalProjectEnvironments } from "../../hooks/useLogicalProjectEnvironments";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  type EnvironmentId,
  type ProviderDriverKind,
  type ModelSelection,
  type ThreadContextRecord,
} from "@t3tools/contracts";
import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isTriagePrompt, replaceTriagePlaybookLink } from "@t3tools/shared/triagePrompt";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { useComposerDraftStore, DraftId } from "../../composerDraftStore";
import { useProjects } from "../../state/entities";
import {
  eligibleLoadBalancingProviders,
  supportsLoadBalancedSelection,
  supportsLoadBalancedStrategy,
  type LoadBalancingSource,
} from "@t3tools/client-runtime/load-balancing";
import { currentClientMetadata } from "../../connection/platform";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { DraftSessionState } from "../../composerDraftStore";
import { loadBalancingSendWarning } from "./composerSend.logic";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { seedDraftModelSelection } from "../../lib/seedDraftModelSelection";
import { draftFanoutSelectionsAtom } from "./chatViewSend";

interface DraftEnvironmentRoutingInput {
  readonly draftId: DraftId | null;
  readonly draftThread: DraftSessionState | null;
  readonly envLocked: boolean;
  readonly automaticEnvironment: boolean;
  readonly logicalProjectEnvironments: ReturnType<typeof useLogicalProjectEnvironments>;
  readonly loadBalancingSources: readonly LoadBalancingSource[];
  readonly loadBalancingSettings: {
    readonly loadBalancingStrategy: "hardware" | "usage";
    readonly loadBalancingWeights: Readonly<Record<string, number>>;
  };
  readonly modelSelection: ModelSelection | null;
  readonly referencedThreadContexts: ReadonlyArray<ThreadContextRecord>;
  readonly selectedProvider: ProviderDriverKind;
  readonly composerHasAttachments: boolean;
  readonly activeProjectKey: string | null;
  readonly activeProjectIsScratch: boolean;
  readonly projectGroupingSettings: ReturnType<typeof selectProjectGroupingSettings>;
  readonly sendInFlightRef: { readonly current: boolean };
}

// Multiple-model selections are kept per route, so a draft moving machine takes them along.
function carryFanoutSelections(
  draft: Pick<DraftSessionState, "environmentId" | "threadId">,
  environmentId: EnvironmentId,
) {
  if (draft.environmentId === environmentId) return;
  const selectionsOn = (id: EnvironmentId) =>
    draftFanoutSelectionsAtom(scopedThreadKey(scopeThreadRef(id, draft.threadId)));
  appAtomRegistry.set(
    selectionsOn(environmentId),
    appAtomRegistry.get(selectionsOn(draft.environmentId)),
  );
}

/**
 * Which machine an unsent draft runs on: automatic load balancing across the
 * project's machines, or a manual switch, which may first open a scratch
 * project on the target machine. A triage draft takes its session along: the
 * target machine prepares one, and the playbook link follows.
 */
export function useDraftEnvironmentRouting(input: DraftEnvironmentRoutingInput) {
  const {
    draftId,
    draftThread,
    envLocked,
    automaticEnvironment,
    logicalProjectEnvironments,
    loadBalancingSources,
    loadBalancingSettings,
    modelSelection,
    selectedProvider,
    referencedThreadContexts,
    composerHasAttachments,
    activeProjectKey,
    activeProjectIsScratch,
    projectGroupingSettings,
    sendInFlightRef,
  } = input;
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const prepareTriage = useAtomCommand(serverEnvironment.prepareTriage, { reportFailure: false });
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const allProjects = useProjects();
  const { openScratchProject } = useScratchProject();
  const candidates = loadBalancingSources.flatMap((source) =>
    eligibleLoadBalancingProviders(source, loadBalancingSettings.loadBalancingStrategy).map(
      (provider) => ({
        environmentId: source.environmentId,
        provider,
        weight: loadBalancingSettings.loadBalancingWeights[source.environmentId] ?? 50,
      }),
    ),
  );
  const resolvedTargetAvailable =
    modelSelection !== null &&
    candidates.some(
      (candidate) =>
        candidate.environmentId === draftThread?.loadBalancedEnvironmentId &&
        candidate.provider.instanceId === modelSelection.instanceId &&
        supportsLoadBalancedSelection(candidate.provider, selectedProvider, modelSelection) &&
        supportsLoadBalancedStrategy(
          candidate.provider,
          loadBalancingSettings.loadBalancingStrategy,
        ),
    );
  const needsLoadBalancing = automaticEnvironment && !resolvedTargetAvailable;
  const loadBalancing = useLoadBalancedEnvironment(
    candidates,
    modelSelection,
    selectedProvider,
    loadBalancingSettings.loadBalancingStrategy,
    needsLoadBalancing && !composerHasAttachments,
  );
  const loadBalancingCandidates = [
    ...new Set(
      logicalProjectEnvironments
        .filter(({ environmentId }) =>
          candidates.some((candidate) => candidate.environmentId === environmentId),
        )
        .map(({ environmentId }) => environmentId),
    ),
  ];
  const readRouting = useStableCallback(() => ({ input, loadBalancingCandidates }));
  const refreshBeforeSend = () => {
    if (
      !automaticEnvironment ||
      !draftId ||
      !draftThread?.loadBalancedEnvironmentId ||
      draftThread.promotedTo ||
      composerHasAttachments
    )
      return null;
    const originalDraft = getDraftSession(draftId);
    const composerDraft = useComposerDraftStore.getState().getComposerDraft(draftId);
    return loadBalancing.refreshSelection(loadBalancingCandidates).then((picked) => {
      const current = readRouting();
      if (
        current.input.draftId !== draftId ||
        !current.input.automaticEnvironment ||
        current.input.composerHasAttachments ||
        current.input.activeProjectKey !== activeProjectKey ||
        current.input.selectedProvider !== selectedProvider ||
        current.input.modelSelection?.instanceId !== modelSelection?.instanceId ||
        current.input.modelSelection?.model !== modelSelection?.model ||
        current.input.loadBalancingSettings.loadBalancingStrategy !==
          loadBalancingSettings.loadBalancingStrategy ||
        current.input.loadBalancingSettings.loadBalancingWeights !==
          loadBalancingSettings.loadBalancingWeights ||
        current.loadBalancingCandidates.join("\n") !== loadBalancingCandidates.join("\n") ||
        getDraftSession(draftId) !== originalDraft ||
        useComposerDraftStore.getState().getComposerDraft(draftId) !== composerDraft
      )
        return false;
      const target = current.input.logicalProjectEnvironments.find(
        (candidate) => candidate.environmentId === picked?.environmentId,
      );
      if (!target?.projectId || !picked || !modelSelection) {
        toastManager.add({
          type: "warning",
          ...loadBalancingSendWarning({
            pending: false,
            threadContexts: referencedThreadContexts,
            candidateEnvironmentIds: loadBalancingCandidates,
          }),
        });
        return false;
      }
      const projectRef = scopeProjectRef(target.environmentId, target.projectId);
      if (originalDraft) carryFanoutSelections(originalDraft, target.environmentId);
      // The send must read the target project's composer and provider context after retargeting.
      flushSync(() => {
        const store = useComposerDraftStore.getState();
        const explicit = composerDraft?.modelSelectionExplicit === true;
        const selected = { ...modelSelection, instanceId: picked.instanceId };
        store.setModelSelection(draftId, selected, { explicit, replaceOptions: true });
        if (explicit) store.setStickyModelSelection(selected);
        setDraftThreadContext(draftId, {
          projectRef,
          environmentSelection: "auto",
          loadBalancedEnvironmentId: target.environmentId,
          branch: originalDraft?.branch ?? null,
        });
      });
      return true;
    });
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the resolved load-balanced environment into the draft store once the async pick settles
  useEffect(() => {
    if (!needsLoadBalancing || loadBalancing.pending || !draftId || sendInFlightRef.current) return;
    const target = logicalProjectEnvironments.find(
      (environment) => environment.environmentId === loadBalancing.environmentId,
    );
    if (!target?.projectId || !loadBalancing.instanceId || !modelSelection) return;
    const store = useComposerDraftStore.getState();
    const explicit = store.getComposerDraft(draftId)?.modelSelectionExplicit === true;
    const resolvedSelection = { ...modelSelection, instanceId: loadBalancing.instanceId };
    store.setModelSelection(draftId, resolvedSelection, { explicit, replaceOptions: true });
    if (explicit) store.setStickyModelSelection(resolvedSelection);
    const draft = getDraftSession(draftId);
    if (draft) carryFanoutSelections(draft, target.environmentId);
    setDraftThreadContext(draftId, {
      projectRef: scopeProjectRef(target.environmentId, target.projectId),
      environmentSelection: "auto",
      loadBalancedEnvironmentId: target.environmentId,
    });
  }, [
    needsLoadBalancing,
    loadBalancing.pending,
    loadBalancing.environmentId,
    loadBalancing.instanceId,
    modelSelection,
    draftId,
    logicalProjectEnvironments,
    sendInFlightRef,
    getDraftSession,
    setDraftThreadContext,
  ]);
  const onAutoEnvironment = () => {
    if (envLocked || !draftId || sendInFlightRef.current) return;
    if (composerHasAttachments) {
      toastManager.add({
        type: "warning",
        id: "load-balancing-attachments",
        title: "Keep attachments on this machine",
        description:
          "Remove attachments before choosing automatic routing, then attach them on the selected machine.",
      });
      return;
    }
    loadBalancing.refresh([
      ...new Set(loadBalancingSources.map((source) => source.environmentId)),
    ] as EnvironmentId[]);
    setDraftThreadContext(draftId, {
      environmentSelection: "auto",
      loadBalancedEnvironmentId: null,
      branch: null,
      worktreePath: null,
    });
  };
  const onAutoEnvironmentStable = useStableCallback(onAutoEnvironment);
  const autoEnvironmentLabel = automaticEnvironment
    ? !needsLoadBalancing
      ? "Auto balance"
      : loadBalancing.pending
        ? "Checking machines…"
        : loadBalancing.failed
          ? "Auto balance unavailable"
          : "Auto balance"
    : undefined;

  // A change in flight belongs to the draft and project it started on.
  const environmentChangeScope = `${draftId ?? ""}:${activeProjectKey ?? ""}`;
  const environmentChangeRef = useRef<{
    readonly environmentId: EnvironmentId;
    readonly scope: string;
  } | null>(null);
  const environmentChangeScopeRef = useRef("");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the current change scope into a ref that async environment switches compare against
  useLayoutEffect(() => {
    environmentChangeScopeRef.current = environmentChangeScope;
  });
  // Leaving the scope, or unmounting, abandons a change still in flight.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- abandons an in-flight environment change when the draft or project scope changes or unmounts
  useLayoutEffect(
    () => () => {
      if (environmentChangeRef.current?.scope === environmentChangeScope) {
        environmentChangeRef.current = null;
      }
    },
    [environmentChangeScope],
  );
  const readPendingEnvironmentChange = () => {
    const pending = environmentChangeRef.current;
    return pending !== null && pending.scope === environmentChangeScopeRef.current ? pending : null;
  };
  // The busy state belongs to the request that set it, so an older request settling late
  // (abandoned, or superseded by a newer switch) can never clear a newer one's.
  const [busyEnvironmentChange, setBusyEnvironmentChange] = useState<{
    readonly environmentId: EnvironmentId;
    readonly scope: string;
  } | null>(null);
  const isEnvironmentChanging = busyEnvironmentChange?.scope === environmentChangeScope;

  const onEnvironmentChange = (nextEnvironmentId: EnvironmentId) => {
    if (envLocked || !draftId || sendInFlightRef.current) return;
    const originalDraft = getDraftSession(draftId);
    if (!originalDraft || originalDraft.promotedTo) return;
    const target = logicalProjectEnvironments.find(
      (env) => env.environmentId === nextEnvironmentId,
    );
    if (!target) return;
    const request = { environmentId: target.environmentId, scope: environmentChangeScope };
    environmentChangeRef.current = request;
    setBusyEnvironmentChange(null);
    // `triagePrompt` is the prompt the target machine prepared for a triage draft.
    const retarget = (project: (typeof allProjects)[number], triagePrompt?: string) => {
      const currentDraft = getDraftSession(draftId);
      if (
        environmentChangeRef.current !== request ||
        environmentChangeScopeRef.current !== request.scope ||
        sendInFlightRef.current ||
        !currentDraft ||
        currentDraft.promotedTo ||
        currentDraft.environmentId !== originalDraft.environmentId ||
        currentDraft.projectId !== originalDraft.projectId
      )
        return;
      if (triagePrompt !== undefined) {
        // Read now, so text typed while the machine prepared the session is kept.
        const prompt = getComposerDraft(draftId)?.prompt ?? "";
        const nextPrompt = replaceTriagePlaybookLink(prompt, triagePrompt);
        if (nextPrompt !== prompt) setPrompt(draftId, nextPrompt);
      }
      carryFanoutSelections(currentDraft, target.environmentId);
      const projectRef = scopeProjectRef(target.environmentId, project.id);
      if (activeProjectIsScratch) {
        setLogicalProjectDraftThreadId(
          deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings),
          projectRef,
          draftId,
          { environmentSelection: "manual", loadBalancedEnvironmentId: null },
        );
      } else {
        setDraftThreadContext(draftId, {
          projectRef,
          environmentSelection: "manual",
          loadBalancedEnvironmentId: null,
        });
      }
      seedDraftModelSelection(draftId, projectRef);
    };
    const finish = () => {
      if (environmentChangeRef.current === request) environmentChangeRef.current = null;
      setBusyEnvironmentChange((busy) => (busy === request ? null : busy));
    };
    const knownProject = allProjects.find(
      (project) =>
        project.environmentId === target.environmentId && project.id === target.projectId,
    );
    // The playbook and context files exist only on the machine that prepared them.
    const followsTriage = isTriagePrompt(getComposerDraft(draftId)?.prompt ?? "");
    if (target.projectId !== null && !(knownProject && followsTriage)) {
      if (knownProject) retarget(knownProject);
      finish();
      return;
    }
    const prepareTriagePrompt = async () => {
      const prepared = await prepareTriage({
        environmentId: target.environmentId,
        input: { client: currentClientMetadata() },
      });
      if (prepared._tag === "Success") return prepared.value.prompt;
      if (!isAtomCommandInterrupted(prepared)) {
        const error = squashAtomCommandFailure(prepared);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not switch machine",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      return null;
    };
    const switchMachine = async () => {
      const triagePrompt = followsTriage ? await prepareTriagePrompt() : undefined;
      if (triagePrompt === null) return;
      const project =
        knownProject ??
        (await openScratchProject(target.environmentId, "Could not switch machine"));
      if (project) retarget(project, triagePrompt);
    };
    setBusyEnvironmentChange(request);
    void switchMachine().finally(finish);
  };
  const onEnvironmentChangeStable = useStableCallback(onEnvironmentChange);

  return {
    needsLoadBalancing,
    loadBalancing,
    refreshBeforeSend,
    onAutoEnvironmentStable,
    autoEnvironmentLabel,
    isEnvironmentChanging,
    readPendingEnvironmentChange,
    onEnvironmentChangeStable,
  };
}
