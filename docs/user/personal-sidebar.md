# Personal sidebar

Named groups organize the Inbox in the same sidebar as Working, Snoozed and
Settled. Those status shelves stay flat. Working and Snoozed threads keep their
group membership when they return to the Inbox. Settling removes a thread from
its group permanently; un-settling or undoing the settle does not restore that
membership. A group is deleted when its last member leaves it.
Pinned Inbox threads also appear in their assigned group.

Use **Customize sidebar → Session groups** to create, rename, reorder or delete groups. Right-click
a thread and choose **Move to group** to assign it, create a group for it, or move
it back to Ungrouped. Removing a group keeps its threads.

Each group folds independently without pausing or settling work. The open Inbox
thread remains visible inside its folded group. Header counts include only unread
completed threads currently in that group, not members in other status shelves.
Project filters still apply. Unavailable threads retain their saved membership
and reappear when their state loads. Ungrouped threads appear directly in the
Inbox, without a folder or collapse control.

Drag cards into a conversation to reference them, or onto the native status
boundaries to pin, unpin, settle, restore or wake them. Within a group, manual
ordering follows the native rules: active ordering is automatic while the Working
section is enabled. Changing group membership still uses **Move to group**;
dragging between groups does not reassign a thread.

The **Icons** tab chooses model-only, model-plus-harness or harness-only
icons. Recognized model families include DeepSeek, Claude, GPT/Codex, Gemini and
Qwen, Kimi, GLM, MiniMax, Doubao/Seed, ERNIE, Hunyuan, Step and Yi. Card and hover-detail icons use the same preference. Unknown models retain their harness icon. Upload a PNG/JPEG/WebP image up to 128 KB for each device, or choose **From text** to generate an image from 1–3 letters or numbers and a color. Reset an override to restore the detected device icon.

Use **All devices** above the project filter to view sessions hosted by one
T3 server, across projects. Device and project filters combine; choose **All
devices** to remove the device filter. The choice is saved on this client.

In **Customize sidebar → Device groups**, create named sets of hosts, such as
“My devices” or a team member’s devices, then select a group in the device filter.
Expand a group to edit its members. You can rename groups or delete them without removing
connections or sessions. A device may appear in more than one group. Grouped devices are omitted from the separate device list; ungrouped devices remain individually selectable. Missing
or disconnected devices retain their membership and report activity as unknown.
Device groups are independent of Inbox thread groups and travel with exported
sidebar preferences. They are available in web and desktop clients.

The device's active count includes queued, starting, running and waiting turns,
including subagents and projects outside the current project filter. Use it to
check for work before updating a host or restarting it. A disconnected device's
activity is unknown; cached sessions cannot confirm that it is idle. The count
covers T3 sessions, not other processes on the machine.

Group and icon preferences belong to the current web or desktop client. **Export
preferences** and **Import preferences** transfer them to another client; import
replaces the current preferences. Thread links identify both environment and
thread, so the destination client must connect to the same environments. This
does not synchronize preferences automatically or move conversation history.
