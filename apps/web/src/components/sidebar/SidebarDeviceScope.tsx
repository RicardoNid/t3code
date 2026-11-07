import { MonitorIcon } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";

export function SidebarDeviceScope(props: {
  devices: readonly {
    environmentId: string;
    label: string;
    connected: boolean;
    live: boolean;
    active: number;
  }[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const selected = props.devices.find((device) => device.environmentId === props.value);
  const status = (device: (typeof props.devices)[number]) =>
    !device.connected
      ? "Disconnected · activity unknown"
      : !device.live
        ? "Loading activity…"
        : `${device.active} active`;
  return (
    <div className="px-2 pb-1">
      <Select
        value={props.value ?? "all"}
        onValueChange={(value) => props.onChange(value === "all" ? null : value)}
      >
        <SelectTrigger size="compact" aria-label="Filter threads by device">
          <MonitorIcon />
          <SelectValue>
            {props.value === null ? "All devices" : (selected?.label ?? "Unavailable device")}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="all">All devices</SelectItem>
          {props.devices.map((device) => (
            <SelectItem key={device.environmentId} value={device.environmentId}>
              <span className="flex flex-col">
                <span>{device.label}</span>
                <span className="text-xs text-muted-foreground">{status(device)}</span>
              </span>
            </SelectItem>
          ))}
          {props.value !== null && !selected ? (
            <SelectItem value={props.value}>Unavailable device · activity unknown</SelectItem>
          ) : null}
        </SelectPopup>
      </Select>
      {props.value !== null ? (
        <p
          role="status"
          aria-label="Device activity"
          className="pt-1 text-2xs text-muted-foreground"
        >
          {selected ? status(selected) : "Activity unknown"}. Across all projects, including
          subagents.
        </p>
      ) : null}
    </div>
  );
}
