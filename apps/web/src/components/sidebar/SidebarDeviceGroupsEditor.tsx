import { useState } from "react";
import { ChevronDownIcon, TrashIcon } from "lucide-react";
import { useSidebarPersonalization } from "../../sidebarPersonalization";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";

export function SidebarDeviceGroupsEditor(props: {
  environments: readonly { environmentId: string; label: string }[];
  onDelete: (id: string) => void;
  onMembersChange: () => void;
}) {
  const [settings, update] = useSidebarPersonalization();
  const [name, setName] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <section className="flex flex-col gap-4" aria-label="Device groups">
      <p className="text-xs text-muted-foreground">
        Filter sessions by a set of hosts, such as your own devices or a team member’s devices.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          const group = { id: randomUUID(), name: name.trim(), members: [] };
          update((current) => ({
            ...current,
            deviceGroups: [...(current.deviceGroups ?? []), group],
          }));
          setName("");
          setExpandedId(group.id);
        }}
      >
        <Input
          aria-label="New device group name"
          placeholder="e.g. My devices"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" aria-label="Create device group" disabled={!name.trim()}>
          Create
        </Button>
      </form>
      {(settings.deviceGroups ?? []).map((group, index) => {
        const devices = new Map(props.environments.map((device) => [device.environmentId, device]));
        for (const member of group.members)
          if (!devices.has(member.environmentId)) devices.set(member.environmentId, member);
        return (
          <Collapsible
            key={group.id}
            open={expandedId === group.id}
            onOpenChange={(open) => setExpandedId(open ? group.id : null)}
          >
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Device group name ${index + 1}`}
                maxLength={80}
                value={group.name}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    deviceGroups: (current.deviceGroups ?? []).map((entry) =>
                      entry.id === group.id ? { ...entry, name: event.target.value } : entry,
                    ),
                  }))
                }
              />
              <CollapsibleTrigger
                render={<Button variant="ghost" size="compact" />}
                aria-label={`Edit devices in ${group.name}`}
              >
                {group.members.length} {group.members.length === 1 ? "device" : "devices"}
                <ChevronDownIcon className={expandedId === group.id ? "rotate-180" : undefined} />
              </CollapsibleTrigger>
              <Button
                size="icon-xs"
                variant="ghost-destructive"
                aria-label={`Delete device group ${group.name}`}
                onClick={() => {
                  update((current) => ({
                    ...current,
                    deviceGroups: (current.deviceGroups ?? []).filter(
                      (entry) => entry.id !== group.id,
                    ),
                  }));
                  props.onDelete(group.id);
                }}
              >
                <TrashIcon />
              </Button>
            </div>
            <CollapsiblePanel animate={false}>
              <div className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-2">
                {[...devices.values()].map((device) => (
                  <label key={device.environmentId} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      aria-label={`${group.name}: ${device.label}`}
                      checked={group.members.some(
                        (member) => member.environmentId === device.environmentId,
                      )}
                      onCheckedChange={(checked) => {
                        update((current) => ({
                          ...current,
                          deviceGroups: (current.deviceGroups ?? []).map((entry) =>
                            entry.id !== group.id
                              ? entry
                              : {
                                  ...entry,
                                  members: checked
                                    ? [
                                        ...entry.members.filter(
                                          (member) => member.environmentId !== device.environmentId,
                                        ),
                                        device,
                                      ]
                                    : entry.members.filter(
                                        (member) => member.environmentId !== device.environmentId,
                                      ),
                                },
                          ),
                        }));
                        props.onMembersChange();
                      }}
                    />
                    <span className="min-w-0 break-words">
                      {device.label}
                      {props.environments.some(
                        (entry) => entry.environmentId === device.environmentId,
                      )
                        ? ""
                        : " (unavailable)"}
                    </span>
                  </label>
                ))}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        );
      })}
    </section>
  );
}
