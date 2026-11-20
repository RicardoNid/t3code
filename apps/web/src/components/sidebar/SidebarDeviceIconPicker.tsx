import { useRef, useState } from "react";
import { T, useGT } from "gt-react";
import { ImageIcon } from "lucide-react";
import { useSidebarPersonalization } from "../../sidebarPersonalization";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Button } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { DeviceTextIconDialog } from "./DeviceTextIconDialog";
import { createDeviceIconImage } from "./deviceIconImage";

export function SidebarDeviceIconPicker(props: {
  environment: { environmentId: string; label: string };
  onError: (message: string | null) => void;
}) {
  const gt = useGT();
  const [settings, update] = useSidebarPersonalization();
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const [textDialogOpen, setTextDialogOpen] = useState(false);
  const { environmentId, label } = props.environment;
  const icon = settings.deviceIcons[environmentId];
  const setIcon = (value: string | null) => {
    selection.current++;
    update((current) => {
      const deviceIcons = { ...current.deviceIcons };
      if (value === null) delete deviceIcons[environmentId];
      else deviceIcons[environmentId] = value;
      return { ...current, deviceIcons };
    });
  };
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
        aria-label={gt("Choose image for {label}", { label })}
        onClick={() => input.current?.click()}
      >
        <T>Upload</T>
      </Button>
      <Button
        variant="outline"
        size="compact"
        aria-label={gt("Generate icon for {label}", { label })}
        onClick={() => setTextDialogOpen(true)}
      >
        <T>From text</T>
      </Button>
      <Button
        variant="ghost"
        size="compact"
        aria-label={gt("Reset icon for {label}", { label })}
        disabled={!icon}
        onClick={() => {
          setIcon(null);
          props.onError(null);
        }}
      >
        <T>Reset</T>
      </Button>
      <input
        ref={input}
        hidden
        type="file"
        aria-label={gt("Upload icon for {label}", { label })}
        accept="image/png,image/jpeg,image/webp"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const request = ++selection.current;
          if (
            !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
            file.size > 131072
          ) {
            props.onError(gt("Choose a PNG, JPEG or WebP image no larger than 128 KB."));
            return;
          }
          try {
            const image = await createDeviceIconImage(file);
            if (input.current && selection.current === request) {
              setIcon(image);
              props.onError(null);
            }
          } catch {
            if (input.current && selection.current === request) {
              props.onError(gt("Could not read the image."));
            }
          }
        }}
      />
      {textDialogOpen ? (
        <DeviceTextIconDialog
          label={label}
          onClose={() => setTextDialogOpen(false)}
          onGenerate={(image) => {
            setIcon(image);
            props.onError(null);
          }}
        />
      ) : null}
    </div>
  );
}
