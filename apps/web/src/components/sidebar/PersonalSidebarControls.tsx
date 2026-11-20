import { T, useGT } from "gt-react";
import { SidebarDeviceIconPicker } from "./SidebarDeviceIconPicker";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SidebarDeviceGroupsEditor } from "./SidebarDeviceGroupsEditor";
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
import { Tabs, TabsList, TabsTab, TabsPanel } from "../ui/tabs";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";

export function PersonalSidebarControls(props: {
  environments: readonly { environmentId: string; label: string }[];
  assignment: { key: string; title: string } | null;
  onAssignmentDone: () => void;
  onDeviceGroupDeleted: (id: string) => void;
  onDeviceGroupsChanged: () => void;
}) {
  const gt = useGT();
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
  const sessionGroups = (
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
              groups: [...current.groups, { id, name: name.trim(), collapsed: false, members: [] }],
            };
            return props.assignment ? assignSidebarGroup(next, props.assignment, id) : next;
          });
          setName("");
          if (props.assignment) finish();
        }}
      >
        <Input
          aria-label={gt("New group name")}
          placeholder={gt("New group, e.g. Scheduling")}
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" disabled={!name.trim()}>
          <T>Create</T>
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
                aria-label={gt("Group name {index}", { index: index + 1 })}
                maxLength={80}
                value={group.name}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    groups: current.groups.map((entry) =>
                      entry.id === group.id ? { ...entry, name: event.target.value } : entry,
                    ),
                  }))
                }
              />
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Move {name} up", { name: group.name })}
                disabled={index === 0}
                onClick={() =>
                  update((current) => {
                    const groups = [...current.groups];
                    [groups[index - 1], groups[index]] = [groups[index]!, groups[index - 1]!];
                    return { ...current, groups };
                  })
                }
              >
                <ArrowUpIcon />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Move {name} down", { name: group.name })}
                disabled={index === settings.groups.length - 1}
                onClick={() =>
                  update((current) => {
                    const groups = [...current.groups];
                    [groups[index], groups[index + 1]] = [groups[index + 1]!, groups[index]!];
                    return { ...current, groups };
                  })
                }
              >
                <ArrowDownIcon />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost-destructive"
                aria-label={gt("Delete group {name}, keeping its threads", { name: group.name })}
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
          <T>Move to Ungrouped</T>
        </Button>
      ) : null}
    </div>
  );
  return (
    <>
      <div className="flex items-center gap-1 px-2 pb-1" aria-label={gt("Sidebar view")}>
        <span className="ml-auto">
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={gt("Customize sidebar")}
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
              {props.assignment ? gt("Move thread to group") : gt("Customize sidebar")}
            </DialogTitle>
            <DialogDescription>
              {props.assignment?.title ??
                gt(
                  "Organize sessions and devices, and customize their icons. Preferences are saved on this client.",
                )}
            </DialogDescription>
          </DialogHeader>
          {props.assignment ? (
            <DialogPanel>{sessionGroups}</DialogPanel>
          ) : (
            <Tabs defaultValue="sessions">
              <div className="shrink-0 px-6">
                <TabsList aria-label={gt("Sidebar customization")}>
                  <TabsTab value="sessions">
                    <T>Session groups</T>
                  </TabsTab>
                  <TabsTab value="devices">
                    <T>Device groups</T>
                  </TabsTab>
                  <TabsTab value="icons">
                    <T>Icons</T>
                  </TabsTab>
                </TabsList>
              </div>
              <DialogPanel>
                <TabsPanel value="sessions">
                  <div className="flex flex-col gap-4">
                    <p className="text-xs text-muted-foreground">
                      <T>
                        Groups organize the Inbox. Settling removes a session from its group
                        permanently. A group is deleted when its last session leaves.
                      </T>
                    </p>
                    {sessionGroups}
                  </div>
                </TabsPanel>
                <TabsPanel value="devices">
                  <SidebarDeviceGroupsEditor
                    environments={props.environments}
                    onDelete={props.onDeviceGroupDeleted}
                    onMembersChange={props.onDeviceGroupsChanged}
                  />
                </TabsPanel>
                <TabsPanel value="icons">
                  <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-2">
                      <Label>
                        <T>Thread icons</T>
                      </Label>
                      <ToggleGroup
                        value={[settings.modelIcons]}
                        onValueChange={(values) => {
                          const value = values[0];
                          if (value === "model" || value === "both" || value === "harness")
                            update((current) => ({ ...current, modelIcons: value }));
                        }}
                        aria-label={gt("Thread icons")}
                      >
                        {(
                          [
                            ["model", gt("Model", { $context: "sidebar thread icon mode" })],
                            [
                              "both",
                              gt("Model + harness", { $context: "sidebar thread icon mode" }),
                            ],
                            ["harness", gt("Harness", { $context: "sidebar thread icon mode" })],
                          ] as const
                        ).map(([value, label]) => (
                          <Toggle key={value} value={value}>
                            {label}
                          </Toggle>
                        ))}
                      </ToggleGroup>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>
                        <T>Device icons</T>
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        <T>
                          PNG, JPEG or WebP, up to 128 KB. Images are resized to fit 256 × 256.
                          Reset restores the default icon.
                        </T>
                      </p>
                      <div className="divide-y divide-border">
                        {props.environments.map((environment) => (
                          <SidebarDeviceIconPicker
                            key={environment.environmentId}
                            environment={environment}
                            onError={setError}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </TabsPanel>
              </DialogPanel>
              <DialogFooter className="shrink-0">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
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
                      <T>Export preferences</T>
                    </Button>
                    <Button variant="outline" onClick={() => importInput.current?.click()}>
                      <T>Import preferences</T>
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
                        if (file.size > 2_000_000) {
                          setError(
                            gt("Invalid preferences file. Existing preferences were not changed."),
                          );
                          return;
                        }
                        try {
                          update(importSidebarPersonalization(await file.text()));
                          props.onDeviceGroupsChanged();
                          setError(null);
                        } catch {
                          setError(
                            gt("Invalid preferences file. Existing preferences were not changed."),
                          );
                        }
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <T>Import replaces these preferences. Export first to keep a backup.</T>
                  </p>
                  {error ? (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  ) : null}
                </div>
              </DialogFooter>
            </Tabs>
          )}
        </DialogPopup>
      </Dialog>
    </>
  );
}
