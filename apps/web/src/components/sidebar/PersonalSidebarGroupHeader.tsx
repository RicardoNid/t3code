import { ChevronDownIcon, FolderIcon } from "lucide-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  countSidebarUnreadCompletions,
  resolveSidebarFolderDot,
  resolveThreadLastVisitedAt,
} from "../Sidebar.logic";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useUiStateStore } from "../../uiStateStore";
import { cn } from "../../lib/utils";

const labels = { attention: "needs you", failed: "failed", unread: "unread", working: "working" };
export function PersonalSidebarGroupHeader(props: {
  id: string;
  name: string;
  collapsed: boolean;
  threads: readonly EnvironmentThreadShell[];
  onToggle: () => void;
}) {
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const threads = props.threads.map((thread) => ({
    ...thread,
    lastVisitedAt: resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      localVisits[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
    ),
  }));
  const status = resolveSidebarFolderDot(threads);
  const unreadCount = countSidebarUnreadCompletions(threads);
  return (
    <li className="mt-2 list-none">
      <button
        type="button"
        data-sidebar-row={`personal-group:${props.id}`}
        aria-expanded={!props.collapsed}
        onClick={props.onToggle}
        className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-sidebar-row-hover focus-visible:outline-2 focus-visible:outline-ring"
      >
        <FolderIcon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {props.name || "Untitled group"}
        </span>
        {status ? (
          <span
            className={cn(
              "text-xs",
              status === "attention" || status === "failed"
                ? "text-warning"
                : "text-muted-foreground",
            )}
          >
            {labels[status]}
          </span>
        ) : null}
        {unreadCount > 0 ? (
          <span
            aria-label={`${unreadCount} unread completions`}
            className="text-xs tabular-nums text-muted-foreground"
          >
            {unreadCount}
          </span>
        ) : null}
        <ChevronDownIcon className={cn("size-3", props.collapsed && "-rotate-90")} aria-hidden />
      </button>
    </li>
  );
}
