import "../../index.css";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { PersonalSidebarControls } from "./PersonalSidebarControls";

it("keeps edits when switching customization tabs and shares import/export across them", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1280, 900);
  await using _viewport = {
    [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height),
  };
  using cleanup = new DisposableStack();
  const key = "t3code:personal-sidebar:v1";
  const previous = localStorage.getItem(key);
  cleanup.defer(() => {
    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
  });
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      view: "status",
      modelIcons: "both",
      groups: [{ id: "tasks", name: "Maintenance", collapsed: false, members: [] }],
      ungroupedCollapsed: false,
      deviceIcons: {},
      deviceGroups: [
        { id: "mine", name: "My devices", members: [{ environmentId: "mac", label: "MacBook" }] },
        { id: "team", name: "Team", members: [{ environmentId: "host-0", label: "Host 1" }] },
      ],
    }),
  );
  await using screen = await render(
    <PersonalSidebarControls
      environments={[
        { environmentId: "mac", label: "MacBook" },
        ...Array.from({ length: 8 }, (_, i) => ({
          environmentId: `host-${i}`,
          label: `Host ${i + 1}`,
        })),
      ]}
      assignment={null}
      onAssignmentDone={() => undefined}
      onDeviceGroupDeleted={() => undefined}
      onDeviceGroupsChanged={() => undefined}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Customize sidebar" }));
  await userEvent.type(
    page.getByRole("textbox", { name: "New group name" }),
    "Draft session group",
  );
  await userEvent.click(page.getByRole("tab", { name: "Device groups", exact: true }));
  await expect
    .element(page.getByRole("textbox", { name: "New group name" }))
    .not.toBeInTheDocument();
  await userEvent.type(
    page.getByRole("textbox", { name: "New device group name" }),
    "Draft device group",
  );
  await userEvent.click(page.getByRole("button", { name: "Edit devices in My devices" }));
  await userEvent.click(page.getByRole("tab", { name: "Icons", exact: true }));
  await expect
    .element(page.getByRole("textbox", { name: "New device group name" }))
    .not.toBeInTheDocument();
  const upload = document.querySelector<HTMLInputElement>(
    'input[aria-label="Upload icon for MacBook"]',
  )!;
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEioAAAAASUVORK5CYII=",
    ),
    (c) => c.charCodeAt(0),
  );
  const image = new File([png], "icon.png", { type: "image/png" });
  await userEvent.upload(upload, image);
  await expect.element(page.getByRole("button", { name: "Reset icon for MacBook" })).toBeEnabled();
  const uploaded = JSON.parse(localStorage.getItem(key)!).deviceIcons.mac;
  expect(uploaded).toMatch(/^data:image\/png;base64,/);
  await userEvent.upload(
    upload,
    new File([new Uint8Array(131073)], "large.png", { type: "image/png" }),
  );
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Choose a PNG, JPEG or WebP image no larger than 128 KB.");
  expect(JSON.parse(localStorage.getItem(key)!).deviceIcons.mac).toBe(uploaded);
  await userEvent.click(page.getByRole("button", { name: "Reset icon for MacBook" }));
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  await userEvent.upload(upload, image);
  await expect.element(page.getByRole("button", { name: "Reset icon for MacBook" })).toBeEnabled();
  await userEvent.click(page.getByRole("button", { name: "Harness", exact: true }));
  await expect
    .element(page.getByRole("button", { name: "Import preferences", exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Export preferences", exact: true }))
    .toBeVisible();
  await userEvent.click(page.getByRole("tab", { name: "Device groups", exact: true }));
  await expect
    .element(page.getByRole("textbox", { name: "New device group name" }))
    .toHaveValue("Draft device group");
  await userEvent.click(page.getByRole("tab", { name: "Session groups", exact: true }));
  await expect
    .element(page.getByRole("textbox", { name: "New group name" }))
    .toHaveValue("Draft session group");
  await userEvent.keyboard("{ArrowRight}{Enter}");
  await expect
    .element(page.getByRole("tab", { name: "Device groups", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  const saved = JSON.parse(localStorage.getItem(key)!);
  expect(saved.deviceIcons).toEqual({ mac: uploaded });
  expect(saved.modelIcons).toBe("harness");
  expect(saved.groups.map((group: { name: string }) => group.name)).toEqual(["Maintenance"]);
  expect(saved.deviceGroups.map((group: { name: string }) => group.name)).toEqual([
    "My devices",
    "Team",
  ]);
});
