import { describe, expect, it } from "vite-plus/test";
import {
  assignSidebarGroup,
  importSidebarPersonalization,
  modelBrand,
  personalSidebarGroups,
  type SidebarPersonalization,
} from "./sidebarPersonalization";

function settings(): SidebarPersonalization {
  return {
    version: 1,
    view: "groups",
    modelIcons: "both",
    ungroupedCollapsed: false,
    deviceIcons: {},
    groups: [
      {
        id: "planning",
        name: "Scheduling",
        collapsed: true,
        members: [
          { key: "px:das", title: "DAS" },
          { key: "mac:das", title: "Other DAS" },
        ],
      },
      { id: "research", name: "Research", collapsed: false, members: [] },
    ],
  };
}

describe("personal sidebar", () => {
  it("moves only membership, preserves order on repeat, and distinguishes environments", () => {
    const original = settings();
    const moved = assignSidebarGroup(
      original,
      { key: "px:das", title: "DAS planning" },
      "research",
    );
    expect(moved.groups[0]?.members.map((member) => member.key)).toEqual(["mac:das"]);
    expect(moved.groups[1]?.members).toEqual([{ key: "px:das", title: "DAS planning" }]);
    expect(assignSidebarGroup(moved, { key: "px:das", title: "DAS planning" }, "research")).toEqual(
      moved,
    );
    expect(
      assignSidebarGroup(moved, { key: "px:das", title: "DAS planning" }, null).groups[1]?.members,
    ).toEqual([]);
    expect(original.groups[0]?.members).toHaveLength(2);
    expect(assignSidebarGroup(original, { key: "px:das", title: "DAS" }, "missing")).toBe(original);
  });

  it("retains unavailable members, reveals the current row, and honors project filtering", () => {
    const available = [
      { key: "px:das", title: "DAS" },
      { key: "px:new", title: "New" },
    ];
    const grouped = personalSidebarGroups(settings(), available, "px:das", true);
    expect(grouped[0]?.members).toHaveLength(2);
    expect(grouped[0]?.visibleMembers.map((member) => member.key)).toEqual(["px:das"]);
    expect(grouped.at(-1)?.members.map((member) => member.key)).toEqual(["px:new"]);
    expect(personalSidebarGroups(settings(), available, null, false)[0]?.members).toHaveLength(1);
    expect(
      personalSidebarGroups({ ...settings(), groups: [] }, available, null, true)[0]?.members,
    ).toEqual(available);
  });

  it("round-trips preferences and rejects ambiguous or unsafe imports", () => {
    expect(importSidebarPersonalization(JSON.stringify(settings()))).toEqual(settings());
    const invalid = [
      { ...settings(), version: 2 },
      { ...settings(), groups: [...settings().groups, settings().groups[0]] },
      {
        ...settings(),
        groups: settings().groups.map((group) => ({
          ...group,
          members: [{ key: "px:das", title: "DAS" }],
        })),
      },
      { ...settings(), deviceIcons: { px: "data:image/svg+xml;base64," + "A".repeat(100) } },
    ];
    for (const value of invalid)
      expect(() => importSidebarPersonalization(JSON.stringify(value))).toThrow();
  });

  it.each([
    ["openrouter/deepseek/deepseek-v3", "deepseek"],
    ["anthropic/claude-sonnet-4-6", "claude"],
    ["openai/gpt-5.4", "openai"],
    ["google/gemini-3-pro", "gemini"],
    ["qwen/qwen3-coder", "qwen"],
    ["my-notdeepseek-model", null],
    ["openrouter/unknown-model", null],
  ])("identifies the model brand in %s", (model, brand) => expect(modelBrand(model!)).toBe(brand));
});
