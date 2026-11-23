import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import disc_burner as app
from backup import backup_disc, destination_from_input
from media import parse_report, parse_scan


class DiscBurnerTests(unittest.TestCase):
    def test_eject_selected_drive(self):
        instance = app.App.__new__(app.App)
        instance.message = ""
        with patch.object(instance, "select_drive", return_value="/dev/sr0"), patch.object(app.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as run:
            instance.eject()
        run.assert_called_once_with(["eject", "/dev/sr0"], capture_output=True, text=True, timeout=30)
        self.assertEqual(instance.message, "Ejected /dev/sr0.")

    def test_close_selected_drive(self):
        instance = app.App.__new__(app.App)
        instance.message = ""
        with patch.object(instance, "select_drive", return_value="/dev/sr0"), patch.object(app.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as run:
            instance.close_tray()
        run.assert_called_once_with(["eject", "-t", "/dev/sr0"], capture_output=True, text=True, timeout=30)
        self.assertEqual(instance.message, "Closed tray on /dev/sr0.")

    def test_library_shortcut_and_backup_destination(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            library = root / "library"
            library.mkdir()
            (root / "a.txt").write_text("hi")
            with patch.object(app, "COMMON_LIBRARY", library):
                entries = app.browser_entries(root, False)
            self.assertTrue(entries[0].shortcut)
            self.assertEqual(entries[0].path, library)
            target = destination_from_input("", root, "OLD DISC")
            self.assertEqual(target, root / "OLD_DISC.iso")
            target.write_text("existing")
            self.assertEqual(destination_from_input("", root, "OLD DISC"), root / "OLD_DISC_2.iso")
            with self.assertRaisesRegex(ValueError, "already exists"):
                destination_from_input(str(target), root, "OLD DISC")

    def test_media_implications_and_erase_command(self):
        summary = "Media summary: 1 session, 1601 data blocks, 3202k data, 677m free\n"
        written_rw = parse_report("/dev/sr0", "Media current: CD-RW\nMedia status : is written , is appendable\n" + summary, 0, "Volume id : 'OLD'\n'/'\n'/file.txt'\n", 0)
        self.assertEqual(written_rw.action, "erase")
        self.assertEqual(written_rw.volume_id, "OLD")
        self.assertIn("/file.txt", written_rw.paths)
        self.assertGreater(written_rw.capacity_bytes, written_rw.free_bytes)
        self.assertIn("blank=fast", app.burn_command("xorriso", "/dev/sr0", Path("/tmp/test.iso"), erase=True))
        written_r = parse_report("/dev/sr0", "Media current: CD-R\nMedia status : is written , is appendable\n" + summary, 0)
        self.assertEqual(written_r.action, "blocked")
        blank_r = parse_report("/dev/sr0", "Media current: CD-R\nMedia status : is blank\nMedia summary: 0 sessions, 0 data blocks, 700m free\n", 0)
        self.assertEqual(blank_r.action, "burn")
        self.assertNotIn("blank=fast", app.burn_command("xorriso", "/dev/sr0", Path("/tmp/test.iso")))

    def test_media_scan_detects_damage_and_incomplete_result(self):
        good = "Media region : 0 , 1599 , + good\nMedia region : 1599 , 2 , 0 tao_end\n"
        self.assertTrue(parse_scan(good, 0)[0])
        self.assertFalse(parse_scan("Media region : 20 , 5 , - unreadable\n", 0)[0])
        self.assertFalse(parse_scan("Media region : 20 , 5 , 0 untested\n", 0)[0])
        self.assertFalse(parse_scan(good, 5)[0])

    def test_duplicate_disc_name_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "a").mkdir()
            (root / "b").mkdir()
            (root / "a" / "same.txt").write_text("a")
            (root / "b" / "same.txt").write_text("b")
            items = [app.validate_item(root / "a" / "same.txt", [])]
            with self.assertRaisesRegex(ValueError, "already used"):
                app.validate_item(root / "b" / "same.txt", items)

    def test_iso_contains_selected_file_and_folder(self):
        xorriso = app.xorriso_path()
        if not xorriso:
            self.skipTest("xorriso is not installed")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "name = café.txt").write_text("hello")
            (root / "folder").mkdir()
            (root / "folder" / "inside.txt").write_text("world")
            items = [app.validate_item(root / "name = café.txt", [])]
            items.append(app.validate_item(root / "folder", items))
            iso = root / "disc.iso"
            built = subprocess.run(app.iso_command(xorriso, iso, items, "TEST_DISC"), env=app.xorriso_env(xorriso), capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stderr)
            inspected = subprocess.run([xorriso, "--no_rc", "-indev", f"stdio:{iso}", "-find", "/", "-exec", "echo", "--", "-end"], env=app.xorriso_env(xorriso), capture_output=True, text=True)
            self.assertEqual(inspected.returncode, 0, inspected.stderr)
            self.assertIn("/name = café.txt", inspected.stdout)
            self.assertIn("/folder/inside.txt", inspected.stdout)
            paths = tuple(line[1:-1] for line in inspected.stdout.splitlines() if line.startswith("'") and line.endswith("'"))
            backup = root / "backup.iso"
            copied = backup_disc(xorriso, str(iso), backup, paths, app.xorriso_env(xorriso), lambda done, total, stage: None, threading.Event())
            self.assertEqual(copied, backup.stat().st_size)
            self.assertGreater(copied, 0)


if __name__ == "__main__":
    unittest.main()
