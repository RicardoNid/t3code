import "../../index.css";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { PersonalSidebarControls } from "./PersonalSidebarControls";

async function renderControls() {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1280, 900);
  const cleanup = new AsyncDisposableStack();
  cleanup.defer(() => page.viewport(viewport.width, viewport.height));
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
  try {
    const screen = cleanup.use(
      await render(
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
      ),
    );
    const resources = cleanup.move();
    return { screen, key, [Symbol.asyncDispose]: () => resources.disposeAsync() };
  } catch (error) {
    await cleanup.disposeAsync();
    throw error;
  }
}

it("keeps edits when switching customization tabs and shares import/export across them", async () => {
  await using setup = await renderControls();
  const { screen, key } = setup;
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
  await userEvent.click(page.getByRole("button", { name: "Generate icon for MacBook" }));
  await userEvent.fill(page.getByRole("textbox", { name: "Letters", exact: true }), "zjk");
  await expect.element(page.getByRole("button", { name: "Use image", exact: true })).toBeEnabled();
  await userEvent.click(page.getByRole("button", { name: "Use image", exact: true }));
  const generated = JSON.parse(localStorage.getItem(key)!).deviceIcons.mac;
  expect(generated).toMatch(/^data:image\/png;base64,/);
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
  expect(saved.deviceIcons).toEqual({ mac: generated });
  expect(saved.modelIcons).toBe("harness");
  expect(saved.groups.map((group: { name: string }) => group.name)).toEqual(["Maintenance"]);
  expect(saved.deviceGroups.map((group: { name: string }) => group.name)).toEqual([
    "My devices",
    "Team",
  ]);
});

it("preserves icon uploads while rejecting unreadable and oversized images", async () => {
  await using setup = await renderControls();
  const { screen, key } = setup;
  await userEvent.click(screen.getByRole("button", { name: "Customize sidebar" }));
  await userEvent.click(page.getByRole("tab", { name: "Icons", exact: true }));
  const upload = document.querySelector<HTMLInputElement>(
    'input[aria-label="Upload icon for MacBook"]',
  )!;
  const original = document.createElement("canvas");
  original.width = 1024;
  original.height = 512;
  const paint = original.getContext("2d")!;
  paint.fillStyle = "#ef4444";
  paint.fillRect(0, 0, 1024, 512);
  const png = new Uint8Array(await (await fetch(original.toDataURL("image/png"))).arrayBuffer());
  const image = new File([png], "icon.png", { type: "image/png" });
  await userEvent.upload(upload, image);
  await expect.element(page.getByRole("button", { name: "Reset icon for MacBook" })).toBeEnabled();
  const uploaded = JSON.parse(localStorage.getItem(key)!).deviceIcons.mac;
  expect(uploaded).toMatch(/^data:image\/png;base64,/);
  const thumbnail = await createImageBitmap(await (await fetch(uploaded)).blob());
  using _thumbnail = { [Symbol.dispose]: () => thumbnail.close() };
  expect([thumbnail.width, thumbnail.height]).toEqual([256, 256]);
  const thumbnailCanvas = document.createElement("canvas");
  thumbnailCanvas.width = thumbnailCanvas.height = 256;
  const thumbnailPixels = thumbnailCanvas.getContext("2d")!;
  thumbnailPixels.drawImage(thumbnail, 0, 0);
  expect(thumbnailPixels.getImageData(128, 20, 1, 1).data[3]).toBe(0);
  expect(thumbnailPixels.getImageData(128, 128, 1, 1).data).toEqual(
    new Uint8ClampedArray([239, 68, 68, 255]),
  );
  await userEvent.upload(upload, new File(["not an image"], "broken.png", { type: "image/png" }));
  await expect.element(page.getByRole("alert")).toHaveTextContent("Could not read the image.");
  expect(JSON.parse(localStorage.getItem(key)!).deviceIcons.mac).toBe(uploaded);
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
});

it("validates text icons and generates the selected color without changing an image on cancel", async () => {
  await using setup = await renderControls();
  const { screen, key } = setup;
  await userEvent.click(screen.getByRole("button", { name: "Customize sidebar" }));
  await userEvent.click(page.getByRole("tab", { name: "Icons", exact: true }));
  const upload = document.querySelector<HTMLInputElement>(
    'input[aria-label="Upload icon for MacBook"]',
  )!;
  const original = document.createElement("canvas");
  original.width = 1024;
  original.height = 512;
  const paint = original.getContext("2d")!;
  paint.fillStyle = "#ef4444";
  paint.fillRect(0, 0, 1024, 512);
  const png = new Uint8Array(await (await fetch(original.toDataURL("image/png"))).arrayBuffer());
  const image = new File([png], "icon.png", { type: "image/png" });
  await userEvent.upload(upload, image);
  await expect.element(page.getByRole("button", { name: "Reset icon for MacBook" })).toBeEnabled();
  const uploaded = JSON.parse(localStorage.getItem(key)!).deviceIcons.mac;
  await userEvent.click(page.getByRole("button", { name: "Generate icon for MacBook" }));
  await expect.element(page.getByRole("button", { name: "Use image", exact: true })).toBeDisabled();
  await userEvent.click(page.getByRole("button", { name: "Cancel", exact: true }));
  expect(JSON.parse(localStorage.getItem(key)!).deviceIcons.mac).toBe(uploaded);
  await userEvent.click(page.getByRole("button", { name: "Generate icon for MacBook" }));
  const letters = page.getByRole("textbox", { name: "Letters", exact: true });
  for (const invalid of ["!", "中", "ß", " "]) {
    await userEvent.fill(letters, invalid);
    await expect
      .element(page.getByRole("button", { name: "Use image", exact: true }))
      .toBeDisabled();
  }
  for (const valid of ["a", "12", "z9x"]) {
    await userEvent.fill(letters, valid);
    await expect.element(letters).toHaveValue(valid.toUpperCase());
    await expect
      .element(page.getByRole("button", { name: "Use image", exact: true }))
      .toBeEnabled();
  }
  await userEvent.fill(letters, "zjk");
  await expect.element(letters).toHaveValue("ZJK");
  await userEvent.click(page.getByRole("button", { name: "Blue", exact: true }));
  await userEvent.click(page.getByRole("button", { name: "Use image", exact: true }));
  const generated = JSON.parse(localStorage.getItem(key)!).deviceIcons.mac;
  expect(generated).toMatch(/^data:image\/png;base64,/);
  expect(generated).not.toBe(uploaded);
  expect(generated.length).toBeLessThanOrEqual(180000);
  const bitmap = await createImageBitmap(await (await fetch(generated)).blob());
  using _bitmap = { [Symbol.dispose]: () => bitmap.close() };
  expect([bitmap.width, bitmap.height]).toEqual([256, 256]);
  const decoded = document.createElement("canvas");
  decoded.width = decoded.height = 256;
  const pixels = decoded.getContext("2d")!;
  pixels.drawImage(bitmap, 0, 0);
  expect(pixels.getImageData(0, 0, 1, 1).data[3]).toBe(0);
  const background = pixels.getImageData(128, 24, 1, 1).data;
  expect(background[3]).toBe(255);
  expect(background[0]).toBeGreaterThan(180);
  expect(background[2]).toBeGreaterThan(background[0]!);
  const data = pixels.getImageData(0, 0, 256, 256).data;
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 255 && data[i]! < 180 && data[i + 2]! > data[i]!) ink++;
  }
  expect(ink).toBeGreaterThan(100);
});
