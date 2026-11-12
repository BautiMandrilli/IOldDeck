"""Spotify worker tests use fake sessions and never contact the user's player."""
import asyncio
import copy
import importlib.util
import json
import struct
import time
import unittest
import zlib
from pathlib import Path

from spotify_bridge import SpotifyService, is_spotify
from setup_spotify import add_card


class Backend:
    def __init__(self):
        self.items = ["OtherPlayer.exe", "Spotify.exe"]
        self.play = True
        self.title = "Canción de prueba"
        self.has_art = True
        self.fail = False
        self.slow = False
        self.enabled = True
        self.calls = []

    async def sessions(self):
        if self.slow:
            await asyncio.sleep(10)
        if self.fail:
            raise OSError("fixture offline")
        return self.items

    def source(self, session):
        return session

    def playing(self, session):
        return self.play

    async def read(self, session):
        return dict(title=self.title, artist="Artista", album="Álbum", playing=self.play, durationMs=180000,
                    positionMs=45000, thumbnail="fixture" if self.has_art else None,
                    controls=dict(playpause=self.enabled, previous=self.enabled, next=self.enabled))

    async def artwork(self, reference):
        def chunk(kind, data):
            return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        rows = b"".join(b"\0" + bytes((20 + y, 150, 75)) * 96 for y in range(96))
        raw = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 96, 96, 8, 2, 0, 0, 0))
        raw += chunk(b"tEXt", b"Title\0" + self.title.encode()) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
        return raw, "image/png"

    async def control(self, session, command):
        self.calls.append((session, command))
        if command == "playpause":
            self.play = not self.play
        else:
            self.title = "Otra canción"
        return True


class TestSpotify(unittest.TestCase):
    def setUp(self):
        self.backend = Backend()
        self.service = SpotifyService(lambda: self.backend, interval=.02, timeout=.1)
        self.service.start()
        self.await_status("ready")

    def tearDown(self):
        self.service.close()

    def await_status(self, status):
        for _ in range(200):
            data = self.service.snapshot()
            if data["status"] == status:
                return data
            time.sleep(.01)
        self.fail("Spotify did not reach " + status)

    def test_selection_excludes_other_players_and_pause_reads_real_state(self):
        self.assertEqual(self.service.snapshot()["sessionId"], "Spotify.exe")
        data = self.service.control("playpause", "Spotify.exe")
        self.assertFalse(data["playing"])
        self.assertEqual(self.backend.calls, [("Spotify.exe", "playpause")])
        self.backend.items = ["OtherPlayer.exe"]
        self.await_status("closed")
        with self.assertRaises(ValueError):
            self.service.control("next", "Spotify.exe")
        self.assertEqual(len(self.backend.calls), 1)

    def test_artwork_changes_and_missing_art_is_allowed(self):
        old = self.service.snapshot()["artworkRevision"]
        data = self.service.control("next", "Spotify.exe")
        self.assertNotEqual(old, data["artworkRevision"])
        self.assertIsNone(self.service.artwork(old))
        self.assertIsNotNone(self.service.artwork(data["artworkRevision"]))
        self.backend.title = "Sin imagen"
        self.backend.has_art = False
        for _ in range(100):
            data = self.service.snapshot()
            if data["title"] == "Sin imagen":
                break
            time.sleep(.01)
        self.assertEqual(data["status"], "ready")
        self.assertEqual(data["artworkRevision"], "")

    def test_closed_idle_error_and_recovery(self):
        self.backend.items = []
        self.assertFalse(self.await_status("closed")["controls"]["next"])
        self.backend.items = ["Spotify.exe"]
        self.backend.title = ""
        self.assertFalse(self.await_status("idle")["playing"])
        self.backend.fail = True
        self.await_status("error")
        self.backend.fail = False
        self.backend.title = "Recuperado"
        self.await_status("ready")

    def test_disallowed_controls_stale_session_and_unknown_command(self):
        self.backend.enabled = False
        for command, session in (("next", "Spotify.exe"), ("playpause", "OtherPlayer.exe"), ("volume", "Spotify.exe")):
            with self.assertRaises(ValueError):
                self.service.control(command, session)
        self.assertEqual(self.backend.calls, [])

    def test_hung_backend_has_timeout_and_recovers(self):
        self.backend.slow = True
        self.await_status("error")
        self.backend.slow = False
        self.await_status("ready")

    def test_missing_dependency_is_nonfatal(self):
        def missing():
            raise ImportError("fixture")
        other = SpotifyService(missing)
        try:
            other.start()
            other.ready.wait(1)
            self.assertEqual(other.snapshot()["status"], "unavailable")
            with self.assertRaises(ValueError):
                other.control("next", "Spotify.exe")
        finally:
            other.close()

    def test_spotify_source_ids(self):
        self.assertTrue(is_spotify("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"))
        self.assertTrue(is_spotify("Spotify.exe"))
        self.assertFalse(is_spotify("NotSpotify.exe"))
        self.assertFalse(is_spotify("chrome.exe"))


class TestSpotifyConfig(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Reuse the isolated server fixture from the existing regression suite.
        from test_server import TestPanelServer
        cls.fixture = TestPanelServer
        cls.fixture.setUpClass()
        cls.panel = cls.fixture.panel

    @classmethod
    def tearDownClass(cls):
        cls.fixture.tearDownClass()

    def test_add_once_no_overlap_and_old_positions_preserved(self):
        cfg = copy.deepcopy(self.panel.DEFAULT)
        cfg["pages"][0]["layout"] = "free"
        old = self.panel.validate(cfg)["pages"][0]["buttons"]
        clean, added = add_card(cfg, self.panel.validate)
        self.assertTrue(added)
        self.assertEqual(clean["version"], 3)
        self.assertEqual(clean["pages"][0]["buttons"][:-1], old)
        card = clean["pages"][0]["buttons"][-1]
        self.assertEqual((card["x"], card["y"], card["w"], card["h"]), (24, 316, 646, 280))
        again, added = add_card(clean, self.panel.validate)
        self.assertFalse(added)
        self.assertEqual(clean, again)

    def test_full_page_does_not_mutate_input(self):
        cfg = {"pages": [{"id": "home", "height": 1400, "layout": "free", "buttons": [
            {"id": "full", "action": "hotkey", "value": "enter", "x": 0, "y": 0, "w": 1024, "h": 1400}]}]}
        before = copy.deepcopy(cfg)
        with self.assertRaises(ValueError):
            add_card(cfg, self.panel.validate)
        self.assertEqual(cfg, before)

    def test_card_inside_folder_and_backup_roundtrip(self):
        cfg, _ = add_card(self.panel.DEFAULT, self.panel.validate)
        cfg["pages"][0]["buttons"].append({"id": "musicfolder", "type": "folder"})
        cfg["pages"][0]["buttons"][-2]["folderId"] = "musicfolder"
        clean = self.panel.validate(cfg)
        self.panel.CONFIG_FILE.write_text(json.dumps(clean), encoding="utf-8")
        self.assertEqual(self.panel.read_backup(self.panel.backup_bytes())[0], clean)
