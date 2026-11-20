import { MonitorIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import type { SidebarDeviceGroup } from "../../sidebarPersonalization";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
  SelectGroup,
  SelectGroupLabel,
} from "../ui/select";

export function SidebarDeviceScope(props: {
  devices: readonly {
    environmentId: string;
    label: string;
    connected: boolean;
    live: boolean;
    active: number;
  }[];
  groups: readonly SidebarDeviceGroup[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const gt = useGT();
  const groupedIds = new Set(
    props.groups.flatMap((group) => group.members.map((member) => member.environmentId)),
  );
  const ungrouped = props.devices.filter((device) => !groupedIds.has(device.environmentId));
  const selected = props.devices.find((device) => device.environmentId === props.value);
  const selectedGroup = props.groups.find((group) => `group:${group.id}` === props.value);
  const status = (device: (typeof props.devices)[number]) =>
    !device.connected
      ? gt("Disconnected · activity unknown")
      : !device.live
        ? gt("Loading activity…")
        : gt("{count} active", { count: device.active });
  const groupStatus = (group: SidebarDeviceGroup) => {
    const members = new Set(group.members.map((member) => member.environmentId));
    const known = props.devices.filter(
      (device) => members.has(device.environmentId) && device.connected && device.live,
    );
    const active = known.reduce((sum, device) => sum + device.active, 0);
    const unknown = members.size - known.length;
    return unknown > 0
      ? gt("{devices} devices · {active} active · {unknown} activity unknown", {
          devices: members.size,
          active,
          unknown,
        })
      : gt("{devices} devices · {active} active", { devices: members.size, active });
  };
  return (
    <div className="px-2 pb-1">
      <Select
        value={props.value ?? "all"}
        onValueChange={(value) => props.onChange(value === "all" ? null : value)}
      >
        <SelectTrigger size="compact" aria-label={gt("Filter threads by device")}>
          <MonitorIcon />
          <SelectValue>
            {props.value === null
              ? gt("All devices")
              : (selectedGroup?.name ??
                selected?.label ??
                (props.value.startsWith("group:")
                  ? gt("Unavailable device group")
                  : gt("Unavailable device")))}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="all">
            <T>All devices</T>
          </SelectItem>
          {props.groups.length > 0 ? (
            <SelectGroup>
              <SelectGroupLabel>
                <T>Device groups</T>
              </SelectGroupLabel>
              {props.groups.map((group) => (
                <SelectItem key={group.id} value={`group:${group.id}`}>
                  <span className="flex flex-col">
                    <span>{group.name}</span>
                    <span className="text-xs text-muted-foreground">{groupStatus(group)}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
          {ungrouped.length > 0 ? (
            <SelectGroup>
              {props.groups.length > 0 ? (
                <SelectGroupLabel>
                  <T>Ungrouped devices</T>
                </SelectGroupLabel>
              ) : null}
              {ungrouped.map((device) => (
                <SelectItem key={device.environmentId} value={device.environmentId}>
                  <span className="flex flex-col">
                    <span>{device.label}</span>
                    <span className="text-xs text-muted-foreground">{status(device)}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
          {props.value !== null && !selected && !selectedGroup ? (
            <SelectItem value={props.value}>
              {props.value.startsWith("group:")
                ? gt("Unavailable device group · activity unknown")
                : gt("Unavailable device · activity unknown")}
            </SelectItem>
          ) : null}
        </SelectPopup>
      </Select>
      {props.value !== null ? (
        <p
          role="status"
          aria-label={gt("Device activity")}
          className="pt-1 text-2xs text-muted-foreground"
        >
          {gt("{status}. Across all projects, including subagents.", {
            status: selectedGroup
              ? groupStatus(selectedGroup)
              : selected
                ? status(selected)
                : gt("Activity unknown"),
          })}
        </p>
      ) : null}
    </div>
  );
}
