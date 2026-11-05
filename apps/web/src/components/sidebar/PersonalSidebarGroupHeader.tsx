import { ChevronDownIcon, FolderIcon } from "lucide-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { resolveSidebarFolderDot } from "../Sidebar.logic";
import { cn } from "../../lib/utils";

const labels = { attention: "needs you", failed: "failed", unread: "unread", working: "working" };
export function PersonalSidebarGroupHeader(props: {
  id: string;
  name: string;
  count: number;
  collapsed: boolean;
  threads: readonly EnvironmentThreadShell[];
  onToggle: () => void;
}) {
  const status = resolveSidebarFolderDot(props.threads);
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
        <span className="text-xs tabular-nums text-muted-foreground">{props.count}</span>
        <ChevronDownIcon className={cn("size-3", props.collapsed && "-rotate-90")} aria-hidden />
      </button>
    </li>
  );
}
