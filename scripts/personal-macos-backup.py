#!/usr/bin/env python3
"""Bounded rollback storage for the personal macOS installation workflow."""
import argparse
import contextlib
import datetime
import json
import pathlib
import plistlib
import shutil
import sqlite3
import subprocess
import tempfile
import zipfile

MARKER = "t3-personal-macos-backup-v1"
USERDATA = (
    "environment-id", "anonymous-id", "device", "secrets", "settings.json",
    "desktop-settings.json", "client-settings.json", "connection-catalog.json",
    "keybindings.json", "keybindings-migrations", "themes", "clerk",
)
CLIENT = ("Local State", "Preferences", "Local Storage", "IndexedDB", "Session Storage",
          "WebStorage", "Cookies", "Cookies-journal", "Partitions", "v1-local-storage-imported")


def metadata(folder):
    return json.loads((folder / "backup.json").read_text())


def write_metadata(folder, value):
    temporary = folder / "backup.json.tmp"
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(folder / "backup.json")


def managed(root):
    result = []
    for folder in root.iterdir():
        if not folder.is_dir() or folder.is_symlink():
            continue
        try:
            value = metadata(folder)
        except (OSError, ValueError):
            continue
        if value.get("format") == MARKER:
            result.append((folder, value))
    return result


def copy_selected(source, destination, names):
    destination.mkdir(parents=True)
    for name in names:
        item = source / name
        if not item.exists():
            continue
        if item.is_symlink():
            raise RuntimeError(f"Refusing to follow backup source symlink: {item}")
        if item.is_dir():
            shutil.copytree(item, destination / name, symlinks=True,
                            ignore=shutil.ignore_patterns("Cache", "Code Cache", "GPUCache", "worktrees", "logs"))
        else:
            shutil.copy2(item, destination / name)


def snapshot(source, destination):
    wal = source.with_name(source.name + "-wal")
    journal = source.with_name(source.name + "-journal")
    mode = "mode=ro" if any(p.exists() and p.stat().st_size for p in (wal, journal)) else "immutable=1"
    with contextlib.closing(sqlite3.connect(source.as_uri() + "?" + mode, uri=True)) as src:
        with contextlib.closing(sqlite3.connect(destination)) as dst:
            src.backup(dst)
            if dst.execute("pragma quick_check").fetchone()[0] != "ok":
                raise RuntimeError("Database snapshot failed integrity check")


def prepare(root, app, home, client):
    if root.is_symlink() or not root.name.endswith(".noindex"):
        raise RuntimeError("Backup directory must end in .noindex")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if any(value["status"] == "pending" for _, value in managed(root)):
        raise RuntimeError("Resolve the pending installation before creating another backup")
    with (app / "Contents/Info.plist").open("rb") as file:
        version = plistlib.load(file)["CFBundleShortVersionString"]
    folder = pathlib.Path(tempfile.mkdtemp(prefix="rollback-", dir=root))
    write_metadata(folder, {"format": MARKER, "status": "pending", "previousVersion": version,
                            "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat()})
    # ditto preserves macOS bundle resources; no unpacked application is kept in rollback storage.
    subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(app),
                    str(folder / "application.zip")], check=True)
    with zipfile.ZipFile(folder / "application.zip") as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Application archive failed verification")
    snapshot(home / "userdata/statev2.sqlite", folder / "statev2.sqlite")
    copy_selected(home / "userdata", folder / "userdata", USERDATA)
    owner = home / "userdata/server-owner.sqlite"
    if owner.exists():
        snapshot(owner, folder / "userdata/server-owner.sqlite")
    copy_selected(home / "ssh-launch", folder / "ssh-launch", ("desktop-only",))
    copy_selected(client, folder / "client", CLIENT)
    value = metadata(folder)
    value["ready"] = True
    write_metadata(folder, value)
    return folder


def cleanup_stage(stage, build_root):
    if stage.is_symlink() or stage.parent.resolve() != build_root.resolve():
        raise RuntimeError("Stage must be a direct, non-symlink child of the build directory")
    if not stage.name.startswith(("package-stage-", "install-stage-")):
        raise RuntimeError("Not an installation staging directory")
    if stage.exists():
        shutil.rmtree(stage)


def verify_spotlight(app):
    result = subprocess.run(["mdfind", '-0', 'kMDItemCFBundleIdentifier == "com.t3tools.t3code"'],
                            check=True, capture_output=True, text=True)
    paths = {pathlib.Path(p) for p in result.stdout.split("\0") if p}
    if paths != {app}:
        raise RuntimeError(f"Spotlight verification failed (index updates may be delayed): {sorted(map(str, paths))}")


def finish(root, folder, keep):
    if keep not in (1, 2) or root.is_symlink() or folder.is_symlink() or folder.parent.resolve() != root.resolve():
        raise RuntimeError("Invalid retention or backup path")
    current = metadata(folder)
    if current.get("format") != MARKER:
        raise RuntimeError("Not a managed rollback backup")
    if not current.get("ready") or current["status"] not in ("pending", "accepted"):
        raise RuntimeError("Backup is incomplete; cannot finalize")
    if any(other != folder and value["status"] == "pending" for other, value in managed(root)):
        raise RuntimeError("Another pending backup exists")
    current["status"] = "accepted"
    write_metadata(folder, current)
    older = sorted(((p, v) for p, v in managed(root) if p != folder and v["status"] == "accepted"),
                   key=lambda item: item[1]["createdAt"], reverse=True)
    for old, _ in older[keep - 1:]:
        shutil.rmtree(old)


def main():
    import os
    os.umask(0o077)
    build = pathlib.Path.home() / "t3-fork-build"
    app = pathlib.Path("/Applications/T3 Code (Beta).app")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    initial = sub.add_parser("prepare", help="Run only after idle verification and stopping the desktop/backend")
    initial.add_argument("--stopped-confirmed", action="store_true", required=True)
    cleanup = sub.add_parser("cleanup-stage", help="Remove only the explicitly named packaging stage")
    cleanup.add_argument("--stage", required=True, type=pathlib.Path)
    final = sub.add_parser("finalize", help="Run only after installation and runtime acceptance")
    final.add_argument("backup", type=pathlib.Path)
    final.add_argument("--stage", required=True, type=pathlib.Path)
    final.add_argument("--expected-version", required=True)
    final.add_argument("--keep", type=int, choices=(1, 2), default=1)
    final.add_argument("--runtime-accepted", action="store_true", required=True)
    args = parser.parse_args()
    root = build / "backups.noindex"
    if args.command == "cleanup-stage":
        cleanup_stage(args.stage, build)
    elif args.command == "prepare":
        print(prepare(root, app, pathlib.Path.home() / ".t3",
                      pathlib.Path.home() / "Library/Application Support/t3code-v2"))
    else:
        with (app / "Contents/Info.plist").open("rb") as file:
            if plistlib.load(file)["CFBundleShortVersionString"] != args.expected_version:
                raise RuntimeError("Installed version mismatch; backups retained")
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
        cleanup_stage(args.stage, build)
        subprocess.run(["mdimport", str(app)], check=True)
        verify_spotlight(app)
        finish(root, args.backup, args.keep)
        print("Accepted; staging removed, Spotlight verified, rollback retention applied")


if __name__ == "__main__":
    main()
