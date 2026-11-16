import { useRef } from "react";
import { ImageIcon } from "lucide-react";
import { useSidebarPersonalization } from "../../sidebarPersonalization";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Button } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

export function SidebarDeviceIconPicker(props: {
  environment: { environmentId: string; label: string };
  onError: (message: string | null) => void;
}) {
  const [settings, update] = useSidebarPersonalization();
  const input = useRef<HTMLInputElement>(null);
  const { environmentId, label } = props.environment;
  const icon = settings.deviceIcons[environmentId];
  const setIcon = (value: string | null) =>
    update((current) => {
      const deviceIcons = { ...current.deviceIcons };
      if (value === null) delete deviceIcons[environmentId];
      else deviceIcons[environmentId] = value;
      return { ...current, deviceIcons };
    });
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center">
        {icon ? (
          <EnvironmentMachineIcon environmentId={environmentId} kind="server" className="size-6" />
        ) : (
          <ImageIcon className="size-5 text-muted-foreground" />
        )}
      </span>
      <Tooltip>
        <TooltipTrigger render={<span className="min-w-0 flex-1 truncate text-sm" />}>
          {label}
        </TooltipTrigger>
        <TooltipPopup>{label}</TooltipPopup>
      </Tooltip>
      <Button
        variant="outline"
        size="compact"
        aria-label={`Choose image for ${label}`}
        onClick={() => input.current?.click()}
      >
        Choose image
      </Button>
      <Button
        variant="ghost"
        size="compact"
        aria-label={`Reset icon for ${label}`}
        disabled={!icon}
        onClick={() => {
          setIcon(null);
          props.onError(null);
        }}
      >
        Reset
      </Button>
      <input
        ref={input}
        hidden
        type="file"
        aria-label={`Upload icon for ${label}`}
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (
            !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
            file.size > 131072
          ) {
            props.onError("Choose a PNG, JPEG or WebP image no larger than 128 KB.");
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              setIcon(reader.result);
              props.onError(null);
            }
          };
          reader.onerror = () => props.onError("Could not read the image.");
          reader.readAsDataURL(file);
        }}
      />
    </div>
  );
}
