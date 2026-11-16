import "../../index.css";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { SidebarDeviceGroupsEditor } from "./SidebarDeviceGroupsEditor";

it("persists device membership and names, including unavailable hosts, without editing thread groups", async () => {
  using cleanup = new DisposableStack();
  const key = "t3code:personal-sidebar:v1";
  const previous = localStorage.getItem(key);
  cleanup.defer(() => {
    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
  });
  const threadGroups = [
    {
      id: "tasks",
      name: "Tasks",
      collapsed: false,
      members: [{ key: "local:task", title: "Task" }],
    },
  ];
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      view: "status",
      modelIcons: "both",
      groups: threadGroups,
      ungroupedCollapsed: false,
      deviceIcons: {},
      deviceGroups: [
        {
          id: "old",
          name: "Previous owner",
          members: [{ environmentId: "offline", label: "Offline host" }],
        },
      ],
    }),
  );
  await using screen = await render(
    <SidebarDeviceGroupsEditor
      environments={[
        { environmentId: "local", label: "LTR-DEV" },
        { environmentId: "mac", label: "MacBook" },
      ]}
      onDelete={() => undefined}
      onMembersChange={() => undefined}
    />,
  );
  await expect.element(screen.getByRole("checkbox")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Edit devices in Previous owner" }));
  await expect
    .element(screen.getByRole("checkbox", { name: "Previous owner: Offline host" }))
    .toBeChecked();
  await userEvent.click(screen.getByRole("checkbox", { name: "Previous owner: LTR-DEV" }));

  await userEvent.type(
    screen.getByRole("textbox", { name: "New device group name" }),
    "My devices",
  );
  await userEvent.click(screen.getByRole("button", { name: "Create device group" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "My devices: LTR-DEV" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "My devices: MacBook" }));
  const read = () => JSON.parse(localStorage.getItem(key)!);
  expect(
    read().deviceGroups[0].members.map((member: { environmentId: string }) => member.environmentId),
  ).toEqual(["offline", "local"]);
  await expect
    .element(screen.getByRole("checkbox", { name: "Previous owner: Offline host" }))
    .not.toBeInTheDocument();
  expect(
    read().deviceGroups[1].members.map((member: { environmentId: string }) => member.environmentId),
  ).toEqual(["local", "mac"]);
  await userEvent.clear(screen.getByRole("textbox", { name: "Device group name 2" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Device group name 2" }), "My fleet");
  await userEvent.click(screen.getByRole("checkbox", { name: "My fleet: MacBook" }));
  expect(
    read().deviceGroups[1].members.map((member: { environmentId: string }) => member.environmentId),
  ).toEqual(["local"]);
  await userEvent.click(screen.getByRole("button", { name: "Delete device group Previous owner" }));
  expect(read().deviceGroups.map((group: { name: string }) => group.name)).toEqual(["My fleet"]);
  expect(read().groups).toEqual(threadGroups);
  await userEvent.click(screen.getByRole("button", { name: "Delete device group My fleet" }));
  expect(read().deviceGroups).toEqual([]);
  expect(read().groups).toEqual(threadGroups);
});
