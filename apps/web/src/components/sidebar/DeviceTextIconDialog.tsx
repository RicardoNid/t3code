import { useLayoutEffect, useRef, useState } from "react";
import type { ProjectIconColor } from "@t3tools/contracts";
import { cn } from "../../lib/utils";
import { PROJECT_ICON_COLORS, projectIconColorClassName } from "../../projectIconColors";
import { validDeviceIcon } from "../../sidebarPersonalization";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

export function DeviceTextIconDialog(props: {
  label: string;
  onClose: () => void;
  onGenerate: (image: string) => void;
}) {
  const [letters, setLetters] = useState("");
  const [color, setColor] = useState<ProjectIconColor>("purple");
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const colorProbe = useRef<HTMLSpanElement>(null);
  const valid = /^[A-Z0-9]{1,3}$/.test(letters);
  const colorClass = projectIconColorClassName(color)
    .split(" ")
    .filter((name) => !name.startsWith("dark:"))
    .join(" ");

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- paint the canvas preview with the selected project color
  useLayoutEffect(() => {
    const preview = canvas.current;
    const probe = colorProbe.current;
    if (!preview || !probe) return;
    const context = preview.getContext("2d");
    if (!context) {
      setError("Could not create the image.");
      return;
    }
    preview.width = preview.height = 256;
    probe.className = colorClass;
    const foreground = getComputedStyle(probe).color;
    context.beginPath();
    context.roundRect(8, 8, 240, 240, 56);
    context.fillStyle = "white";
    context.fill();
    context.fillStyle = foreground;
    context.globalAlpha = 0.14;
    context.fill();
    context.globalAlpha = 1;
    context.font =
      '700 96px ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace';
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.fillText(valid ? letters : "ABC", 128, 162, 216);
    setError(null);
  }, [letters, colorClass, valid]);

  const save = () => {
    if (!valid || error || !canvas.current) return;
    try {
      const image = canvas.current.toDataURL("image/png");
      if (!validDeviceIcon(image)) {
        setError("Could not save the image. Please try again.");
        return;
      }
      props.onGenerate(image);
      props.onClose();
    } catch {
      setError("Could not save the image. Please try again.");
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="w-full sm:w-[26rem]">
        <DialogHeader>
          <DialogTitle>Create icon from text</DialogTitle>
          <DialogDescription>{props.label} · Saved on this client only.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex items-center gap-4">
            <canvas
              ref={canvas}
              width={256}
              height={256}
              className="size-20 shrink-0"
              aria-label="Icon preview"
            />
            <span ref={colorProbe} hidden />
            <div className="min-w-0 flex-1 space-y-2">
              <label htmlFor="device-icon-letters" className="text-sm font-medium">
                Letters
              </label>
              <Input
                id="device-icon-letters"
                value={letters}
                maxLength={3}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="device-icon-hint"
                onChange={(event) =>
                  setLetters(
                    event.currentTarget.value.replace(/[a-z]/g, (letter) => letter.toUpperCase()),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") save();
                }}
              />
              <p id="device-icon-hint" className="text-xs text-muted-foreground">
                1–3 letters (A–Z) or numbers.
              </p>
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Color</div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Icon color">
              {PROJECT_ICON_COLORS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-label={option.label}
                  aria-pressed={color === option.value}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    color === option.value && "border-foreground/64",
                  )}
                  onClick={() => setColor(option.value)}
                >
                  <span className={cn("size-4 rounded-full", option.swatchClassName)} />
                </button>
              ))}
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || Boolean(error)} onClick={save}>
            Use image
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
