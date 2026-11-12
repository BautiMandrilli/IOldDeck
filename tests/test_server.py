"""Regression checks that never read the user's data/ directory."""
import importlib.util
import io
import os
import json
import shutil
import tempfile
import unittest
import zipfile
import warnings
from unittest import mock
from pathlib import Path


class TestPanelServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        source = Path(__file__).resolve().parents[1] / "server.py"
        copy = Path(cls.temp.name) / "server.py"
        shutil.copy2(source, copy)
        spec = importlib.util.spec_from_file_location("panel_test", copy)
        cls.panel = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.panel)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        panel = self.panel
        panel.CONFIG_FILE.write_text(json.dumps(panel.DEFAULT), encoding="utf-8")
        panel.ASSET_DIR.mkdir(exist_ok=True)
        panel.ASSET_INDEX.write_text("[]", encoding="utf-8")
        panel.BUTTON_STATES.clear()

    def request(self, path, body, local=True, authorized=True):
        panel = self.panel

        class Request:
            def __init__(self):
                self.path = path
                self.client_address = ("127.0.0.1" if local else "192.168.1.5", 1)
                self.headers = {"Content-Length": str(len(body)), "X-Panel-Token": panel.TOKEN if authorized else "wrong"}
                self.rfile = io.BytesIO(body)

            authorized = panel.Handler.authorized

            def json_response(self, code, value):
                self.code, self.value = code, value

        request = Request()
        panel.Handler.do_POST(request)
        return request

    def archive(self, cfg=None, extras=None):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("config.json", json.dumps(cfg or self.panel.DEFAULT))
            archive.writestr("assets/index.json", "[]")
            for name, data in (extras or {}).items():
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    archive.writestr(name, data)
        return stream.getvalue()

    def folder_config(self):
        cfg = json.loads(json.dumps(self.panel.DEFAULT))
        buttons = cfg["pages"][0]["buttons"]
        buttons.append({"id": "tools", "type": "folder", "label": "Herramientas"})
        buttons[0]["folderId"] = "tools"
        return cfg

    def test_legacy_positions_survive_validation(self):
        cfg = self.folder_config()
        cfg["pages"][0].pop("layout")
        old = cfg["pages"][0]["buttons"][0]
        old.update(x=53, y=71, w=240, h=150)
        clean = self.panel.validate(cfg)
        self.assertEqual(clean["version"], 3)
        self.assertEqual(clean["pages"][0]["layout"], "free")
        button = clean["pages"][0]["buttons"][0]
        self.assertEqual([button[k] for k in ("x", "y", "w", "h")], [53, 71, 240, 150])
        clean["pages"][0]["layout"] = "grid"
        self.assertEqual(self.panel.validate(clean)["pages"][0]["buttons"][0], button)

    def test_invalid_folder_relationships(self):
        for parent in ("missing", "google", "other-page-folder"):
            cfg = self.folder_config()
            cfg["pages"][0]["buttons"][0]["folderId"] = parent
            with self.assertRaises(ValueError):
                self.panel.validate(cfg)
        cfg = self.folder_config()
        cfg["pages"][0]["buttons"][-1]["folderId"] = "tools"
        with self.assertRaises(ValueError):
            self.panel.validate(cfg)

    def test_actions_inside_folder_and_folder_not_executable(self):
        self.panel.CONFIG_FILE.write_text(json.dumps(self.folder_config()), encoding="utf-8")
        with mock.patch.object(self.panel, "send_hotkey") as hotkey:
            result = self.request("/api/action", b'{"id":"mute"}')
            self.assertEqual(result.code, 200)
            self.assertTrue(result.value["states"]["mute"])
            hotkey.assert_called_once_with("ctrl+shift+m")
            self.assertEqual(self.request("/api/action", b'{"id":"tools"}').code, 404)

    def test_url_inside_folder_opens_on_pc(self):
        cfg = self.folder_config()
        cfg["pages"][0]["buttons"][2]["folderId"] = "tools"
        self.panel.CONFIG_FILE.write_text(json.dumps(cfg), encoding="utf-8")
        with mock.patch.object(self.panel.webbrowser, "open") as browser:
            result = self.request("/api/action", b'{"id":"google"}')
            self.assertEqual(result.code, 200)
            browser.assert_called_once_with("https://www.google.com/", new=2)

    def test_hotkey_events_carry_scan_codes(self):
        scans = {0xA2: 0x1D, 0xA0: 0x2A, 0x31: 0x02, 0x25: 0xE04B}
        events = self.panel.hotkey_events("ctrl+shift+1", scans.get)
        self.assertEqual(events, [(0xA2, 0x1D, 0), (0xA0, 0x2A, 0), (0x31, 0x02, 0),
                                  (0x31, 0x02, 2), (0xA0, 0x2A, 2), (0xA2, 0x1D, 2)])
        self.assertEqual(self.panel.hotkey_events("ctrl+left", scans.get)[1], (0x25, 0x4B, 1))
        if os.name == "nt":  # Modifier scan codes are the same on every keyboard layout.
            real = self.panel.hotkey_events("ctrl+shift+1")
            self.assertEqual([(vk, code) for vk, code, _ in real[:2]], [(0xA2, 0x1D), (0xA0, 0x2A)])
            self.assertTrue(all(code for _vk, code, _flags in real))

    def test_desktop_app_opens_installed_app_or_website(self):
        cfg = self.folder_config()
        cfg["pages"][0]["buttons"][2].update(action="app", value="discord")
        self.panel.CONFIG_FILE.write_text(json.dumps(cfg), encoding="utf-8")
        with mock.patch.object(self.panel, "launch_uri") as launch, \
                mock.patch.object(self.panel, "bring_app_forward") as forward, \
                mock.patch.object(self.panel.webbrowser, "open") as browser:
            with mock.patch.object(self.panel, "app_installed", return_value=True):
                result = self.request("/api/action", b'{"id":"google"}')
            self.assertEqual((result.code, result.value["opened"]), (200, "app"))
            launch.assert_called_once_with("discord://-/")
            forward.assert_called_once_with("discord")
            browser.assert_not_called()
            with mock.patch.object(self.panel, "app_installed", return_value=False):
                result = self.request("/api/action", b'{"id":"google"}')
            self.assertEqual(result.value["opened"], "web")
            browser.assert_called_once_with("https://discord.com/app", new=2)
            self.assertEqual((launch.call_count, forward.call_count), (1, 1))

    def test_games_launch_only_when_the_game_is_installed(self):
        panel = self.panel
        cfg = self.folder_config()
        cfg["pages"][0]["buttons"][2].update(action="app", value="leagueoflegends")
        panel.CONFIG_FILE.write_text(json.dumps(cfg), encoding="utf-8")
        riot = r"D:\Riot Games\Riot Client\RiotClientServices.exe"
        with mock.patch.object(panel, "launch_exe") as exe, mock.patch.object(panel, "launch_uri") as uri,                 mock.patch.object(panel, "bring_app_forward"), mock.patch.object(panel.webbrowser, "open") as browser:
            with mock.patch.object(panel, "riot_client_exe", return_value=riot):
                result = self.request("/api/action", b'{"id":"google"}')
            self.assertEqual(result.value["opened"], "app")
            exe.assert_called_once_with([riot, "--launch-product=league_of_legends", "--launch-patchline=live"])
            with mock.patch.object(panel, "riot_client_exe", return_value=None):
                self.assertEqual(self.request("/api/action", b'{"id":"google"}').value["opened"], "web")
            browser.assert_called_once_with("https://www.leagueoflegends.com/", new=2)
            uri.assert_not_called()
        # Steam/Epic being installed is not enough: the game itself must be.
        with mock.patch.object(panel, "app_installed", return_value=True):
            with mock.patch.object(panel, "steam_app_installed", return_value=True):
                self.assertEqual(panel.app_target("counterstrike"), "steam://rungameid/730")
            with mock.patch.object(panel, "steam_app_installed", return_value=False):
                self.assertIsNone(panel.app_target("counterstrike"))
            with mock.patch.object(panel, "epic_app_installed", return_value=True):
                self.assertTrue(panel.app_target("fortnite").startswith("com.epicgames.launcher://apps/"))
            with mock.patch.object(panel, "epic_app_installed", return_value=False):
                self.assertIsNone(panel.app_target("fortnite"))

    def test_theme_is_validated_and_defaults_to_classic(self):
        cfg = self.folder_config()
        self.assertEqual(self.panel.validate(cfg)["theme"], "clasico")
        cfg["theme"] = "aurora"
        self.assertEqual(self.panel.validate(cfg)["theme"], "aurora")
        cfg["theme"] = "<script>"
        self.assertEqual(self.panel.validate(cfg)["theme"], "clasico")

    def test_desktop_app_rejects_unknown_or_raw_schemes(self):
        cfg = self.folder_config()
        for value in ("calc", "ms-msdt:/id", "file:///C:/Windows/System32/cmd.exe", ""):
            cfg["pages"][0]["buttons"][2].update(action="app", value=value)
            with self.assertRaises(ValueError):
                self.panel.validate(cfg)

    def test_icon_presentation_persists_and_legacy_keeps_labels(self):
        cfg = self.folder_config()
        button = cfg["pages"][0]["buttons"][0]
        button.update(displayMode="icon", builtinIcon="mic")
        clean = self.panel.validate(cfg)
        self.assertEqual(clean["pages"][0]["buttons"][0]["displayMode"], "icon")
        self.assertEqual(clean["pages"][0]["buttons"][0]["builtinIcon"], "mic")
        self.assertEqual(clean["pages"][0]["buttons"][1]["displayMode"], "both")
        self.panel.CONFIG_FILE.write_text(json.dumps(clean), encoding="utf-8")
        restored = self.panel.read_backup(self.panel.backup_bytes())[0]
        self.assertEqual(restored, clean)
        button["builtinIcon"] = "unknown-icon"
        with self.assertRaises(ValueError):
            self.panel.validate(cfg)
        button.update(builtinIcon="mic", displayMode="invalid")
        with self.assertRaises(ValueError):
            self.panel.validate(cfg)

    def test_app_library_icons_validate(self):
        cfg = self.folder_config()
        button = cfg["pages"][0]["buttons"][0]
        button.update(displayMode="both", builtinIcon="app:youtube")
        self.assertEqual(self.panel.validate(cfg)["pages"][0]["buttons"][0]["builtinIcon"], "app:youtube")
        for bad in ("app:", "app:You Tube", "app:../x", "app:" + "a" * 41):
            button["builtinIcon"] = bad
            with self.assertRaises(ValueError):
                self.panel.validate(cfg)

    def test_backup_round_trip_includes_images_and_excludes_token(self):
        panel = self.panel
        url = "/assets/" + "a" * 32 + ".png"
        image = b"\x89PNG\r\n\x1a\nfixture"
        (panel.DATA / url.lstrip("/")).write_bytes(image)
        panel.ASSET_INDEX.write_text(json.dumps([{"url": url, "name": "Foto", "mime": "image/png"}]), encoding="utf-8")
        cfg = self.folder_config()
        cfg["pages"][0]["backgroundImage"] = url
        cfg["pages"][0]["buttons"][0]["icon"] = url
        panel.CONFIG_FILE.write_text(json.dumps(cfg), encoding="utf-8")
        body = panel.backup_bytes()
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            self.assertNotIn("token.txt", archive.namelist())
            self.assertEqual(archive.read(url.lstrip("/")), image)
        before = panel.CONFIG_FILE.read_bytes()
        preview = self.request("/api/restore?preview=1", body)
        self.assertEqual(preview.code, 200)
        self.assertEqual(preview.value["folders"], 1)
        self.assertEqual(preview.value["buttons"], 3)
        self.assertEqual(panel.CONFIG_FILE.read_bytes(), before)
        token = panel.TOKEN_FILE.read_bytes()
        restored = self.request("/api/restore", body)
        self.assertEqual(restored.code, 200)
        current = panel.validate(panel.config())
        new_url = current["pages"][0]["backgroundImage"]
        self.assertNotEqual(new_url, url)
        self.assertEqual((panel.DATA / new_url.lstrip("/")).read_bytes(), image)
        self.assertEqual(current["pages"][0]["buttons"][0]["icon"], new_url)
        self.assertEqual(panel.TOKEN_FILE.read_bytes(), token)
        prior = panel.read_backup((panel.DATA / restored.value["backup"]).read_bytes())
        self.assertEqual(prior[0], panel.validate(cfg))

    def test_invalid_backups_do_not_modify_data(self):
        cfg = self.folder_config()
        cfg["pages"][0]["backgroundImage"] = "/assets/" + "b" * 32 + ".png"
        invalid = [b"not zip", self.archive(extras={"../outside": b"bad"}),
                   self.archive(extras={"token.txt": b"secret"}), self.archive(cfg=cfg),
                   self.archive(extras={"assets/index.json": b"{}"})]
        before = self.panel.CONFIG_FILE.read_bytes()
        for body in invalid:
            self.assertEqual(self.request("/api/restore", body).code, 400)
            self.assertEqual(self.panel.CONFIG_FILE.read_bytes(), before)

    def test_restore_rollback_on_commit_failure(self):
        panel = self.panel
        before = panel.CONFIG_FILE.read_bytes()
        index_before = panel.ASSET_INDEX.read_bytes()
        original = Path.replace

        def fail_config(path, target):
            if target == panel.CONFIG_FILE:
                raise OSError("Simulated config commit failure")
            return original(path, target)

        with mock.patch.object(Path, "replace", fail_config):
            result = self.request("/api/restore", self.archive())
        self.assertEqual(result.code, 500)
        self.assertEqual(panel.CONFIG_FILE.read_bytes(), before)
        self.assertEqual(panel.ASSET_INDEX.read_bytes(), index_before)

    def test_restore_access_checks(self):
        body = self.archive()
        self.assertEqual(self.request("/api/restore", body, local=False).code, 403)
        self.assertEqual(self.request("/api/restore?preview=1", body, authorized=False).code, 401)

        class Request:
            path = "/api/backup"
            headers = {"X-Panel-Token": self.panel.TOKEN}
            client_address = ("192.168.1.5", 1)
            authorized = self.panel.Handler.authorized

            def json_response(self, code, value):
                self.code = code

        request = Request()
        self.panel.Handler.do_GET(request)
        self.assertEqual(request.code, 403)

    def test_rejects_invalid_types_limits_and_future_versions(self):
        malformed = [dict(self.panel.DEFAULT, version=99),
                     {"pages": [None]},
                     {"pages": [{"id": "home", "buttons": [None]}]},
                     {"pages": [{"id": "home", "buttons": [{}] * 81}]},
                     {"pages": [{"id": "home", "buttons": []}] * 13}]
        for raw in malformed:
            with self.assertRaises(ValueError):
                self.panel.validate(raw)

    def test_restore_rejects_invalid_image_and_oversized_entry(self):
        url = "/assets/" + "c" * 32 + ".png"
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("config.json", json.dumps(self.panel.DEFAULT))
            archive.writestr("assets/index.json", json.dumps([{"url": url, "name": "bad", "mime": "image/png"}]))
            archive.writestr(url.lstrip("/"), b"not an image")
        self.assertEqual(self.request("/api/restore", stream.getvalue()).code, 400)
        self.assertEqual(self.request("/api/restore", self.archive(extras={"assets/" + "d" * 32 + ".png": b"0" * 2500001})).code, 400)

    def test_legacy_discord_button_gets_feedback(self):
        old = {"title": "Mi panel", "pages": [{"id": "inicio", "title": "Inicio", "buttons": [
            {"id": "mute", "label": "Mutear Discord", "color": "purple", "size": "normal", "action": "hotkey", "value": "ctrl+shift+m"}
        ]}]}
        button = self.panel.validate(old)["pages"][0]["buttons"][0]
        self.assertEqual(button["feedback"]["mode"], "toggle")
        self.assertEqual(button["feedback"]["activeLabel"], "🔇 Discord muteado")

    def test_svg_rejects_scripts(self):
        bad = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'
        with self.assertRaises(ValueError):
            self.panel.safe_svg(bad)

    def test_spotify_endpoints_require_authentication(self):
        panel = self.panel
        for path in ("/api/spotify/state", "/api/spotify/artwork?revision=fixture"):
            class Request:
                headers = {}
                authorized = panel.Handler.authorized

                def json_response(self, code, value):
                    self.code = code
            request = Request()
            request.path = path
            panel.Handler.do_GET(request)
            self.assertEqual(request.code, 401)
        self.assertEqual(self.request("/api/spotify/control", b'{"command":"next"}', authorized=False).code, 401)
        self.assertEqual(self.request("/api/spotify/control", b'{"command":"volume"}').code, 400)

    def test_spotify_card_cannot_execute_as_normal_button(self):
        cfg = json.loads(json.dumps(self.panel.DEFAULT))
        cfg["pages"][0]["buttons"].append({"id": "player", "type": "spotify"})
        self.panel.CONFIG_FILE.write_text(json.dumps(cfg), encoding="utf-8")
        self.assertEqual(self.request("/api/action", b'{"id":"player"}').code, 404)

    def test_second_server_cannot_share_the_port(self):
        # Two servers on one port means two pairing codes; the second must fail loudly.
        first = self.panel.PanelServer(("127.0.0.1", 0), self.panel.Handler)
        try:
            with self.assertRaises(OSError):
                self.panel.PanelServer(("127.0.0.1", first.server_address[1]), self.panel.Handler)
        finally:
            first.server_close()

    def test_mute_feedback_toggles_after_action(self):
        panel = self.panel
        original = panel.send_hotkey
        panel.send_hotkey = lambda key: None

        class Request:
            authorized = panel.Handler.authorized

            def __init__(self):
                self.path = "/api/action"
                self.client_address = ("127.0.0.1", 1)
                body = json.dumps({"id": "mute"}).encode("utf-8")
                self.headers = {"Content-Length": str(len(body)), "X-Panel-Token": panel.TOKEN}
                self.rfile = io.BytesIO(body)

            def json_response(self, code, value):
                self.code, self.value = code, value

        try:
            first = Request()
            panel.Handler.do_POST(first)
            second = Request()
            panel.Handler.do_POST(second)
            self.assertEqual(first.code, 200)
            self.assertTrue(first.value["states"]["mute"])
            self.assertFalse(second.value["states"]["mute"])
            self.assertGreater(second.value["version"], first.value["version"])
        finally:
            panel.send_hotkey = original


if __name__ == "__main__":
    unittest.main()
