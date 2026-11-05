import { useRef, useState } from "react";
import { randomUUID } from "../../lib/utils";
import { ArrowDownIcon, ArrowUpIcon, Settings2Icon, TrashIcon } from "lucide-react";
import {
  assignSidebarGroup,
  importSidebarPersonalization,
  useSidebarPersonalization,
} from "../../sidebarPersonalization";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "../ui/dialog";

export function PersonalSidebarControls(props: {
  environments: readonly { environmentId: string; label: string }[];
  assignment: { key: string; title: string } | null;
  onAssignmentDone: () => void;
}) {
  const [settings, update] = useSidebarPersonalization();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const finish = () => {
    setOpen(false);
    props.onAssignmentDone();
    setError(null);
  };
  const move = (groupId: string | null) => {
    const member = props.assignment;
    if (member) update((current) => assignSidebarGroup(current, member, groupId));
    finish();
  };
  return (
    <>
      <div className="flex items-center gap-1 px-2 pb-1" aria-label="Sidebar view">
        <span className="ml-auto">
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Customize sidebar"
            onClick={() => setOpen(true)}
          >
            <Settings2Icon />
          </Button>
        </span>
      </div>
      <Dialog
        open={open || props.assignment !== null}
        onOpenChange={(next) => {
          if (!next) finish();
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              {props.assignment ? "Move thread to group" : "Customize sidebar"}
            </DialogTitle>
            <DialogDescription>
              {props.assignment?.title ??
                "Groups organize the Inbox. Working, Snoozed and Settled keep their own shelves; group membership is preserved. Preferences are saved on this client; export them to use on another device."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!name.trim()) return;
                  const id = randomUUID();
                  update((current) => {
                    const next = {
                      ...current,
                      view: "status" as const,
                      groups: [
                        ...current.groups,
                        { id, name: name.trim(), collapsed: false, members: [] },
                      ],
                    };
                    return props.assignment ? assignSidebarGroup(next, props.assignment, id) : next;
                  });
                  setName("");
                  if (props.assignment) finish();
                }}
              >
                <Input
                  aria-label="New group name"
                  placeholder="New group, e.g. Scheduling"
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <Button type="submit" disabled={!name.trim()}>
                  Create
                </Button>
              </form>
              {settings.groups.map((group, index) => (
                <div key={group.id} className="flex items-center gap-2">
                  {props.assignment ? (
                    <Button variant="outline" onClick={() => move(group.id)}>
                      {group.name}
                    </Button>
                  ) : (
                    <>
                      <Input
                        aria-label={`Group name ${index + 1}`}
                        maxLength={80}
                        value={group.name}
                        onChange={(event) =>
                          update((current) => ({
                            ...current,
                            groups: current.groups.map((entry) =>
                              entry.id === group.id
                                ? { ...entry, name: event.target.value }
                                : entry,
                            ),
                          }))
                        }
                      />
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Move ${group.name} up`}
                        disabled={index === 0}
                        onClick={() =>
                          update((current) => {
                            const groups = [...current.groups];
                            [groups[index - 1], groups[index]] = [
                              groups[index]!,
                              groups[index - 1]!,
                            ];
                            return { ...current, groups };
                          })
                        }
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Move ${group.name} down`}
                        disabled={index === settings.groups.length - 1}
                        onClick={() =>
                          update((current) => {
                            const groups = [...current.groups];
                            [groups[index], groups[index + 1]] = [
                              groups[index + 1]!,
                              groups[index]!,
                            ];
                            return { ...current, groups };
                          })
                        }
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost-destructive"
                        aria-label={`Delete group ${group.name}, keeping its threads`}
                        onClick={() =>
                          update((current) => ({
                            ...current,
                            groups: current.groups.filter((entry) => entry.id !== group.id),
                          }))
                        }
                      >
                        <TrashIcon />
                      </Button>
                    </>
                  )}
                  <span className="text-xs text-muted-foreground">{group.members.length}</span>
                </div>
              ))}
              {props.assignment ? (
                <Button variant="outline" onClick={() => move(null)}>
                  Move to Ungrouped
                </Button>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <Label>Thread icons</Label>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          ["model", "Model"],
                          ["both", "Model + harness"],
                          ["harness", "Harness"],
                        ] as const
                      ).map(([value, label]) => (
                        <Button
                          key={value}
                          size="compact"
                          variant={settings.modelIcons === value ? "default" : "ghost"}
                          aria-pressed={settings.modelIcons === value}
                          onClick={() => update((current) => ({ ...current, modelIcons: value }))}
                        >
                          {settings.modelIcons === value ? "✓ " : ""}
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Device icons</Label>
                    <p className="text-xs text-muted-foreground">
                      Use an emoji, short label or PNG/JPEG/WebP image up to 128 KB. Clear to
                      restore the default.
                    </p>
                    {props.environments.map((environment) => {
                      const icon = settings.deviceIcons[environment.environmentId] ?? "";
                      const setIcon = (value: string) =>
                        update((current) => ({
                          ...current,
                          deviceIcons: {
                            ...current.deviceIcons,
                            [environment.environmentId]: value,
                          },
                        }));
                      return (
                        <div key={environment.environmentId} className="flex flex-col gap-1">
                          <Label>{environment.label}</Label>
                          <div className="flex items-center gap-2">
                            {icon.startsWith("data:image/") ? (
                              <img
                                src={icon}
                                alt={environment.label}
                                className="size-6 object-contain"
                              />
                            ) : null}
                            <Input
                              aria-label={`Icon for ${environment.label}`}
                              placeholder="Emoji or initials"
                              maxLength={32}
                              value={icon.startsWith("data:") ? "" : icon}
                              onChange={(event) => setIcon(event.target.value)}
                            />
                            <Button variant="ghost" size="compact" onClick={() => setIcon("")}>
                              Clear
                            </Button>
                          </div>
                          <input
                            type="file"
                            aria-label={`Upload icon for ${environment.label}`}
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (!file) return;
                              if (
                                !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
                                file.size > 131072
                              ) {
                                setError("Choose a PNG, JPEG or WebP image no larger than 128 KB.");
                                return;
                              }
                              const reader = new FileReader();
                              reader.onload = () => {
                                if (typeof reader.result === "string") {
                                  setIcon(reader.result);
                                  setError(null);
                                }
                              };
                              reader.onerror = () => setError("Could not read the image.");
                              reader.readAsDataURL(file);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        const url = URL.createObjectURL(
                          new Blob([JSON.stringify(settings, null, 2)], {
                            type: "application/json",
                          }),
                        );
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = "t3-sidebar.json";
                        link.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      Export preferences
                    </Button>
                    <Button variant="outline" onClick={() => importInput.current?.click()}>
                      Import preferences
                    </Button>
                    <input
                      ref={importInput}
                      hidden
                      type="file"
                      accept="application/json"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        try {
                          if (file.size > 2_000_000)
                            throw new Error("Preferences file is too large.");
                          update(importSidebarPersonalization(await file.text()));
                          setError(null);
                        } catch {
                          setError(
                            "Invalid preferences file. Existing preferences were not changed.",
                          );
                        }
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Import replaces these preferences. Export first to keep a backup.
                  </p>
                </>
              )}
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}
