# Personal desktop development

This fork's personal sidebar runs in the shared web UI, including Electron on
macOS and Linux. Mobile SDKs and Windows build tools are not required.

Install the repository's pinned Vite+ version in this checkout (requires an
existing Node installation for bootstrap):

```sh
curl -fsSL https://vite.plus -o /tmp/t3-vp-install.sh
VP_HOME="$PWD/.tooling/vite-plus" VP_VERSION=1.4.0 VP_NODE_MANAGER=no bash /tmp/t3-vp-install.sh
./scripts/personal-dev install
```

On managed company machines, prefix network downloads with `get-dep`.
The wrapper installs the Node version from `package.json` and puts it first on
PATH only for its child process. It does not change the system Node installation.
Installation selects web, server, desktop and their workspace dependencies,
plus the repository's scripts and lint plugin. Some shared JavaScript packages
also serve mobile features; this does not install Android or iOS SDKs.

On Linux, install `libsecret-1-dev` and a C/C++ build toolchain for the desktop
credential helper. Build macOS artifacts on the MacBook using Xcode Command Line
Tools; use the existing `dist:desktop:dmg:arm64` or `dist:desktop:dmg:x64` task for
the matching architecture. Packaging and signing are separate from the shared
desktop build.

```sh
./scripts/personal-dev build
./scripts/personal-dev dev
# Or start the Electron shell:
./scripts/personal-dev desktop
```

Development state lives in `.t3-personal`, never the live `~/.t3/userdata`.
Use the pairing URL printed by the development runner to open a new browser.

## Desktop-owned homes

On machines where the desktop app owns the default T3 home, reserve it before
enabling SSH connections:

```sh
mkdir -p "$HOME/.t3/ssh-launch"
touch "$HOME/.t3/ssh-launch/desktop-only"
```

Updated SSH clients then reuse a running backend without replacing or stopping
it. When no backend is running, SSH asks for the desktop app to be started instead
of launching a competing CLI server. Enable desktop login startup on that host;
this marker does not launch the app. Remove the marker to restore SSH auto-start.
Older clients do not honor this policy, so update every client with an SSH route
to the host. Enabling it leaves existing servers running; move an already running
SSH backend to the desktop only in an idle maintenance window.

Focused tests can run without loading the mobile test configuration:

```sh
./scripts/personal-dev test --project unit src/sidebarPersonalization.test.ts src/components/Sidebar.logic.test.ts
./scripts/personal-dev test --project browser src/components/Sidebar.browser.test.tsx
```

## Ubuntu release packages

On Linux x64, packaging produces both an AppImage and a Debian package. Install
ImageMagick and Rust 1.95.0 in addition to the build dependencies above. Select
that Rust toolchain only for the build; no system-wide default change is needed.

```sh
get-dep rustup toolchain install 1.95.0 --profile minimal
RUSTUP_TOOLCHAIN=1.95.0 get-dep ./scripts/personal-dev run dist:desktop:linux \
  --build-version 0.1.7-personal.20261105 \
  --output-dir "$HOME/t3-release/0.1.7-personal.20261105"
```

Use a new personal version and output directory for each release. This command
builds local artifacts and does not publish them to GitHub. On machines without
`get-dep`, omit that prefix.

The wrapper also places the system C compiler first under its isolated tool
directory: packaging probes `cc` directly, so setting `CC` alone cannot bypass a
shell launcher with the same name.
