import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";
import {
  readLocalStorageValue,
  subscribeLocalStorageKey,
  writeLocalStorageValue,
} from "./hooks/useLocalStorage";

const Member = Schema.Struct({ key: Schema.String, title: Schema.String });
const Group = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  collapsed: Schema.Boolean,
  members: Schema.Array(Member),
});
export const SidebarDeviceGroup = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  members: Schema.Array(Schema.Struct({ environmentId: Schema.String, label: Schema.String })),
});
export type SidebarDeviceGroup = typeof SidebarDeviceGroup.Type;

export const SidebarPersonalization = Schema.Struct({
  version: Schema.Literal(1),
  view: Schema.Literals(["status", "groups"]),
  modelIcons: Schema.Literals(["model", "both", "harness"]),
  groups: Schema.Array(Group),
  ungroupedCollapsed: Schema.Boolean,
  deviceIcons: Schema.Record(Schema.String, Schema.String),
  deviceGroups: Schema.optionalKey(Schema.Array(SidebarDeviceGroup)),
});
export type SidebarPersonalization = typeof SidebarPersonalization.Type;
const defaults: SidebarPersonalization = {
  version: 1,
  view: "status",
  modelIcons: "both",
  groups: [],
  ungroupedCollapsed: false,
  deviceIcons: {},
};

const storageKey = "t3code:personal-sidebar:v1";
let cachedText: string | null | undefined;
let cachedSettings = defaults;
function snapshot() {
  let text: string | null = null;
  try {
    text = typeof window === "undefined" ? null : window.localStorage.getItem(storageKey);
  } catch {
    return defaults;
  }
  if (text !== cachedText) {
    cachedText = text;
    cachedSettings = readLocalStorageValue(storageKey, defaults, SidebarPersonalization);
  }
  return cachedSettings;
}
const subscribe = (listener: () => void) => subscribeLocalStorageKey(storageKey, listener);
const update = (
  value: SidebarPersonalization | ((current: SidebarPersonalization) => SidebarPersonalization),
) => writeLocalStorageValue(storageKey, value, defaults, SidebarPersonalization);

export function useSidebarPersonalization() {
  return [useSyncExternalStore(subscribe, snapshot, () => defaults), update] as const;
}

export function removeSidebarGroupMembers(
  settings: SidebarPersonalization,
  threadKeys: ReadonlySet<string>,
): SidebarPersonalization {
  let changed = false;
  const groups = settings.groups.flatMap((group) => {
    const members = group.members.filter((member) => !threadKeys.has(member.key));
    if (members.length === group.members.length) return [group];
    changed = true;
    return members.length === 0 ? [] : [{ ...group, members }];
  });
  return changed ? { ...settings, groups } : settings;
}

export function removeThreadsFromSidebarGroups(threadKeys: ReadonlySet<string>) {
  const current = readLocalStorageValue(storageKey, defaults, SidebarPersonalization);
  const next = removeSidebarGroupMembers(current, threadKeys);
  if (next !== current) update(next);
}

export function assignSidebarGroup(
  settings: SidebarPersonalization,
  member: typeof Member.Type,
  groupId: string | null,
): SidebarPersonalization {
  if (groupId !== null && !settings.groups.some((group) => group.id === groupId)) return settings;
  return {
    ...settings,
    groups: settings.groups.flatMap((group) => {
      const members =
        group.id === groupId && group.members.some((entry) => entry.key === member.key)
          ? group.members.map((entry) => (entry.key === member.key ? member : entry))
          : [
              ...group.members.filter((entry) => entry.key !== member.key),
              ...(group.id === groupId ? [member] : []),
            ];
      if (group.members.length > 0 && members.length === 0) return [];
      return [{ ...group, members }];
    }),
  };
}

export function personalSidebarGroups(
  settings: SidebarPersonalization,
  available: readonly { key: string; title: string }[],
  activeKey: string | null,
  includeUnavailable: boolean,
) {
  const byKey = new Map(available.map((member) => [member.key, member]));
  const assigned = new Set(
    settings.groups.flatMap((group) => group.members.map((member) => member.key)),
  );
  const groups = [
    ...settings.groups,
    {
      id: "",
      name: "Ungrouped",
      collapsed: false,
      members: available.filter((member) => !assigned.has(member.key)),
    },
  ];
  return groups.map((group) => {
    const memberKeys = new Set(group.members.map((member) => member.key));
    const members = [
      ...available.filter((member) => memberKeys.has(member.key)),
      ...(includeUnavailable ? group.members.filter((member) => !byKey.has(member.key)) : []),
    ];
    return {
      ...group,
      members,
      visibleMembers: members.filter((member) => !group.collapsed || member.key === activeKey),
    };
  });
}

export function validDeviceIcon(value: string): boolean {
  return (
    (value.length <= 32 && !value.startsWith("data:")) ||
    (value.length <= 180_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value))
  );
}

const decodePreferences = Schema.decodeSync(Schema.fromJsonString(SidebarPersonalization));

export function importSidebarPersonalization(text: string): SidebarPersonalization {
  const settings = decodePreferences(text);
  const ids = new Set<string>();
  const members = new Set<string>();
  for (const group of settings.groups) {
    if (!group.id || ids.has(group.id) || !group.name.trim())
      throw new Error("Group names and unique IDs are required.");
    ids.add(group.id);
    for (const member of group.members) {
      if (!member.key.includes(":") || members.has(member.key))
        throw new Error("Each thread must belong to one group.");
      members.add(member.key);
    }
  }
  const deviceGroupIds = new Set<string>();
  for (const group of settings.deviceGroups ?? []) {
    if (!group.id.trim() || deviceGroupIds.has(group.id) || !group.name.trim())
      throw new Error("Device group names and unique IDs are required.");
    deviceGroupIds.add(group.id);
    const devices = new Set<string>();
    for (const member of group.members) {
      if (!member.environmentId.trim() || devices.has(member.environmentId))
        throw new Error("Devices must be unique within a group.");
      devices.add(member.environmentId);
    }
  }
  if (!Object.values(settings.deviceIcons).every(validDeviceIcon))
    throw new Error("Unsupported device icon.");
  return settings;
}

export function modelBrand(
  model: string,
):
  | "deepseek"
  | "claude"
  | "openai"
  | "gemini"
  | "qwen"
  | "kimi"
  | "zhipu"
  | "minimax"
  | "doubao"
  | "baidu"
  | "hunyuan"
  | "stepfun"
  | "yi"
  | null {
  const name = model.toLowerCase();
  if (/(?:^|[/:._-])deepseek(?:[/:._-]|$)/.test(name)) return "deepseek";
  if (/(?:^|[/:._-])claude(?:[/:._-]|$)/.test(name)) return "claude";
  if (/(?:^|[/:._-])(?:gpt|chatgpt|codex|o[134])(?:[/:._-]|$)/.test(name)) return "openai";
  if (/(?:^|[/:._-])gemini(?:[/:._-]|$)/.test(name)) return "gemini";
  if (/(?:^|[/:._-])qwen\d*(?:[/:._-]|$)/.test(name)) return "qwen";
  if (/(?:^|[/:._-])(?:kimi|moonshot)(?:[/:._-]|$)/.test(name)) return "kimi";
  if (/(?:^|[/:._-])(?:glm|zhipu|zai)(?:[/:._-]|$)/.test(name)) return "zhipu";
  if (/(?:^|[/:._-])minimax(?:[/:._-]|$)/.test(name)) return "minimax";
  if (/(?:^|[/:._-])(?:doubao|seed)(?:[/:._-]|$)/.test(name)) return "doubao";
  if (/(?:^|[/:._-])ernie(?:[/:._-]|$)/.test(name)) return "baidu";
  if (/(?:^|[/:._-])hunyuan(?:[/:._-]|$)/.test(name)) return "hunyuan";
  if (/(?:^|[/:._-])(?:stepfun|step)(?:[/:._-]|$)/.test(name)) return "stepfun";
  if (/(?:^|[/:._-])yi(?:[/:._-]|$)/.test(name)) return "yi";
  return null;
}
