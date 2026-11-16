import importlib.util
import pathlib
import plistlib
import sqlite3
import tempfile
import unittest
import sys
import zipfile
from unittest.mock import patch

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("backup", pathlib.Path(__file__).with_name("personal-macos-backup.py"))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def test_snapshot_reads_committed_wal_and_excludes_bulk_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            home = root / "home"
            data = home / "userdata"
            data.mkdir(parents=True)
            client = root / "client"
            client.mkdir()
            (client / "Preferences").write_text("preferences")
            (client / "Cache").mkdir()
            (client / "Cache/large").write_text("cache")
            (data / "environment-id").write_text("identity")
            (data / "attachments").mkdir()
            (data / "attachments/large").write_text("attachment")
            app = root / "Installed.app"
            (app / "Contents").mkdir(parents=True)
            (app / "Contents/Info.plist").write_bytes(plistlib.dumps({"CFBundleShortVersionString": "old"}))
            with sqlite3.connect(data / "server-owner.sqlite") as owner:
                owner.execute("create table auth(value)")
                owner.execute("insert into auth values (1)")
            source = sqlite3.connect(data / "statev2.sqlite")
            self.addCleanup(source.close)
            source.execute("pragma journal_mode=wal")
            source.execute("create table sample(value)")
            source.execute("insert into sample values ('committed')")
            source.commit()

            def ditto(command, **_):
                with zipfile.ZipFile(command[-1], "w") as archive:
                    archive.write(app / "Contents/Info.plist", "Installed.app/Contents/Info.plist")

            with patch.object(backup.subprocess, "run", side_effect=ditto):
                folder = backup.prepare(root / "backups.noindex", app, home, client)
            with sqlite3.connect(folder / "statev2.sqlite") as snapshot:
                self.assertEqual(snapshot.execute("select value from sample").fetchall(), [("committed",)])
            with sqlite3.connect(folder / "userdata/server-owner.sqlite") as owner:
                self.assertEqual(owner.execute("select value from auth").fetchall(), [(1,)])
            self.assertTrue((folder / "application.zip").exists())
            self.assertTrue((folder / "userdata/environment-id").exists())
            self.assertTrue((folder / "client/Preferences").exists())
            self.assertFalse((folder / "client/Cache").exists())
            self.assertFalse((folder / "userdata/attachments").exists())
            self.assertFalse(list(folder.rglob("*.app")))
            self.assertTrue(app.exists())
            with self.assertRaisesRegex(RuntimeError, "pending"):
                backup.prepare(root / "backups.noindex", app, home, client)

    def test_retention_keeps_current_even_with_old_timestamp_and_preserves_unmanaged_data(self):
        for keep in (1, 2):
            with self.subTest(keep=keep), tempfile.TemporaryDirectory() as temporary:
                root = pathlib.Path(temporary)
                for name, status, date in [("a", "accepted", "3"), ("b", "accepted", "2"), ("current", "pending", "1")]:
                    folder = root / name
                    folder.mkdir()
                    backup.write_metadata(folder, {"format": backup.MARKER, "status": status, "createdAt": date, "ready": True})
                unmanaged = root / "manual-backup"
                unmanaged.mkdir()
                current = backup.metadata(root / "current")
                backup.write_metadata(root / "current", {**current, "ready": False})
                with self.assertRaisesRegex(RuntimeError, "incomplete"):
                    backup.finish(root, root / "current", keep)
                self.assertTrue((root / "a").exists())
                self.assertTrue((root / "b").exists())
                backup.write_metadata(root / "current", current)
                backup.finish(root, root / "current", keep)
                self.assertEqual(len(backup.managed(root)), keep)
                self.assertTrue((root / "current").exists())
                self.assertEqual((root / "a").exists(), keep == 2)
                self.assertTrue(unmanaged.exists())
                with self.assertRaises(RuntimeError):
                    backup.finish(root, root / "current", 3)

    def test_stage_validation_and_spotlight_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            installed = root / "Installed.app"
            installed.mkdir()
            with self.assertRaises(RuntimeError):
                backup.cleanup_stage(installed, root)
            stage = root / "package-stage-next.noindex"
            stage.mkdir()
            (stage / "copy.app").mkdir()
            backup.cleanup_stage(stage, root)
            self.assertFalse(stage.exists())
            self.assertTrue(installed.exists())
            with patch.object(backup.subprocess, "run") as run:
                run.return_value.stdout = str(installed) + "\0/old/copy.app\0"
                with self.assertRaisesRegex(RuntimeError, "Spotlight"):
                    backup.verify_spotlight(installed)
                run.return_value.stdout = str(installed) + "\0"
                backup.verify_spotlight(installed)


if __name__ == "__main__":
    unittest.main()
