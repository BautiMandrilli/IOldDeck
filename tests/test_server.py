"""Regression checks that never read the user's data/ directory."""
import importlib.util
import io
import json
import shutil
import tempfile
import unittest
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
