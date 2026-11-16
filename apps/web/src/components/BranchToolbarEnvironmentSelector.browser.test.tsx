import { EnvironmentId } from "@t3tools/contracts";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import { Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { useSidebarPersonalization } from "../sidebarPersonalization";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";

vi.mock(import("../state/server"), () => ({
  primaryServerKeybindingsAtom: Atom.make(mergeWithDefaultKeybindings([])),
}));

const environmentId = EnvironmentId.make("icon-device");

function Preferences({ icon }: { icon: string }) {
  const [, update] = useSidebarPersonalization();
  return (
    <>
      <button
        onClick={() =>
          update((current) => ({ ...current, deviceIcons: { [environmentId]: icon } }))
        }
      >
        Set device icon
      </button>
      <button onClick={() => update((current) => ({ ...current, deviceIcons: {} }))}>
        Clear device icon
      </button>
    </>
  );
}

function deviceIcon(element: Element) {
  return element.querySelector("image")?.getAttribute("href") ?? element.textContent;
}

it.each([
  "🍓",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZfoAAAAASUVORK5CYII=",
])("updates run-on choices and restores the default after clearing %s", async (icon) => {
  await using screen = await render(
    <>
      <Preferences icon={icon} />
      <BranchToolbarEnvironmentSelector
        envLocked={false}
        environmentId={environmentId}
        availableEnvironments={[
          {
            environmentId,
            label: "Dev machine",
            machine: "server",
            projectId: null,
            isPrimary: false,
          },
        ]}
        onEnvironmentChange={() => undefined}
      />
    </>,
  );

  await screen.getByRole("button", { name: "Set device icon" }).click();
  const trigger = screen.getByRole("combobox", { name: "Run on" });
  await vi.waitFor(() => expect(deviceIcon(trigger.element())).toContain(icon));
  await trigger.click();
  await vi.waitFor(() =>
    expect(deviceIcon(page.getByRole("option", { name: /Dev machine/ }).element())).toContain(icon),
  );
  await page.getByRole("option", { name: /Dev machine/ }).click();
  await screen.getByRole("button", { name: "Clear device icon" }).click();
  await vi.waitFor(() => expect(deviceIcon(trigger.element())).not.toContain(icon));
});
