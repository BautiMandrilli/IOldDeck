"""Local Spotify sessions only. WinRT objects stay on one async worker thread."""
import asyncio
import copy
import datetime
import hashlib
import re
import sys
import threading
import time
from concurrent.futures import TimeoutError as FutureTimeout


def is_spotify(source):
    source = str(source).casefold()
    return source in ("spotify", "spotify.exe") or bool(re.fullmatch(
        r"spotifyab\.spotifymusic_[a-z0-9]+!spotify", source)) or source.endswith("\\spotify.exe")


class WindowsBackend:
    def __init__(self):
        if sys.platform != "win32":
            raise ImportError("Esta integración requiere Windows")
        import winrt.runtime
        from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionManager
        from winrt.windows.storage.streams import DataReader
        winrt.runtime.init_apartment(winrt.runtime.ApartmentType.MULTI_THREADED)
        self.manager_type = GlobalSystemMediaTransportControlsSessionManager
        self.reader_type = DataReader
        self.manager = None

    async def sessions(self):
        if self.manager is None:
            self.manager = await self.manager_type.request_async()
        return list(self.manager.get_sessions())

    def source(self, session):
        return session.source_app_user_model_id

    def playing(self, session):
        # GlobalSystemMediaTransportControlsSessionPlaybackStatus.PLAYING = 4.
        return int(session.get_playback_info().playback_status) == 4

    async def read(self, session):
        props = await session.try_get_media_properties_async()
        info, timeline = session.get_playback_info(), session.get_timeline_properties()
        playing = int(info.playback_status) == 4
        duration = max(0, (timeline.end_time - timeline.start_time).total_seconds() * 1000)
        position = max(0, (timeline.position - timeline.start_time).total_seconds() * 1000)
        if playing and duration:
            changed = timeline.last_updated_time
            if changed.tzinfo is None:
                changed = changed.replace(tzinfo=datetime.timezone.utc)
            position += max(0, (datetime.datetime.now(datetime.timezone.utc) - changed).total_seconds() * 1000)
        controls = info.controls
        return {"title": props.title or "", "artist": props.artist or "", "album": props.album_title or "",
                "playing": playing, "durationMs": int(duration), "positionMs": int(min(position, duration)) if duration else 0,
                "controls": {"playpause": bool(controls.is_pause_enabled if playing else controls.is_play_enabled),
                             "previous": bool(controls.is_previous_enabled), "next": bool(controls.is_next_enabled)},
                "thumbnail": props.thumbnail}

    async def artwork(self, reference):
        if reference is None:
            return None
        stream = await reference.open_read_async()
        try:
            if stream.size > 5000000:
                return None
            reader = self.reader_type(stream)
            try:
                await reader.load_async(stream.size)
                raw = bytearray(stream.size)
                reader.read_bytes(raw)
                raw = bytes(raw)
            finally:
                reader.detach_stream()
                reader.close()
            mime = str(stream.content_type or "")
            if raw.startswith(b"\x89PNG\r\n\x1a\n"):
                mime = "image/png"
            elif raw.startswith(b"\xff\xd8"):
                mime = "image/jpeg"
            else:
                return None
            return raw, mime
        finally:
            stream.close()

    async def control(self, session, command):
        methods = {"playpause": session.try_toggle_play_pause_async,
                   "next": session.try_skip_next_async, "previous": session.try_skip_previous_async}
        return await methods[command]()


class SpotifyService:
    def __init__(self, backend_factory=WindowsBackend, interval=2, timeout=3):
        self.factory, self.interval, self.timeout = backend_factory, interval, timeout
        self.lock = threading.Lock()
        self.state = self.empty("starting", "Conectando con Spotify…")
        self.art = None
        self.sample_time = time.monotonic()
        self.loop = None
        self.ready = threading.Event()
        self.thread = None
        self.selected = ""
        self.track_key = None

    @staticmethod
    def empty(status, message):
        return {"status": status, "message": message, "title": "", "artist": "", "album": "",
                "playing": False, "positionMs": 0, "durationMs": 0, "artworkRevision": "",
                "sessionId": "", "controls": {"playpause": False, "previous": False, "next": False}}

    def start(self):
        with self.lock:
            if self.thread is None:
                self.thread = threading.Thread(target=self._run, name="spotify", daemon=True)
                self.thread.start()

    def _publish(self, state, art=None):
        with self.lock:
            self.state, self.art, self.sample_time = state, art, time.monotonic()

    def snapshot(self):
        self.start()
        with self.lock:
            result = copy.deepcopy(self.state)
            result["ageMs"] = int((time.monotonic() - self.sample_time) * 1000)
        return result

    def artwork(self, revision):
        with self.lock:
            if revision and self.state["artworkRevision"] == revision:
                return self.art
        return None

    def _run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.guard = asyncio.Lock()
        try:
            self.backend = self.factory()
        except ImportError:
            self.backend = None
            self._publish(self.empty("unavailable", "Instalá la integración en la PC: npm run setup:spotify"))
        except Exception:
            self.backend = None
            self._publish(self.empty("error", "Windows no permitió iniciar la sesión multimedia. Reiniciá el servidor en tu sesión de usuario."))
        self.ready.set()
        self.loop.create_task(self._poll())
        self.loop.run_forever()
        tasks = asyncio.all_tasks(self.loop)
        for task in tasks:
            task.cancel()
        self.loop.run_until_complete(asyncio.gather(*tasks, return_exceptions=True))
        self.loop.close()
        if self.backend is not None and isinstance(self.backend, WindowsBackend):
            import winrt.runtime
            winrt.runtime.uninit_apartment()

    async def _pick(self):
        sessions = [s for s in await self.backend.sessions() if is_spotify(self.backend.source(s))]
        current = next((s for s in sessions if self.backend.source(s) == self.selected), None)
        if current is None:
            current = next((s for s in sessions if self.backend.playing(s)), sessions[0] if sessions else None)
        self.selected = self.backend.source(current) if current else ""
        return current

    async def _refresh(self):
        session = await self._pick()
        if session is None:
            self.track_key = None
            self._publish(self.empty("closed", "Abrí Spotify y reproducí una canción en esta PC."))
            return
        data = await self.backend.read(session)
        thumbnail = data.pop("thumbnail", None)
        key = (self.selected, data["title"], data["artist"], data["album"])
        art = self.art if key == self.track_key else None
        if art is None and thumbnail is not None:
            try:
                art = await asyncio.wait_for(self.backend.artwork(thumbnail), self.timeout)
            except Exception:
                art = None  # Artwork never disables playback controls.
        self.track_key = key
        data.update(status="ready" if data["title"] else "idle", message="" if data["title"] else "Reproducí una canción en Spotify.",
                    sessionId=self.selected, artworkRevision=hashlib.sha256(art[0]).hexdigest() if art else "")
        if not data["title"]:
            data["playing"] = False
        self._publish(data, art)

    async def _poll(self):
        if self.backend is None:
            return
        while True:
            async with self.guard:
                try:
                    await asyncio.wait_for(self._refresh(), self.timeout + 1)
                except Exception:
                    self._publish(self.empty("error", "No se pudo leer Spotify. Reintentando…"))
            await asyncio.sleep(self.interval)

    async def _control(self, command, expected):
        if self.backend is None:
            raise ValueError("La integración de Spotify no está disponible")
        async with self.guard:
            session = await self._pick()
            if session is None or not expected or self.selected != expected:
                raise ValueError("La sesión de Spotify cambió. Esperá a que se actualice la tarjeta.")
            data = await self.backend.read(session)
            if not data["controls"].get(command):
                raise ValueError("Spotify no permite este control en este momento")
            if not await self.backend.control(session, command):
                raise ValueError("Spotify no aceptó el control")
            # Acceptance precedes the Windows state event, especially on resume.
            # Wait briefly for the real state instead of inventing optimistic feedback.
            for _ in range(10 if command == "playpause" else 1):
                await asyncio.sleep(.15 if command == "playpause" else .25)
                if command != "playpause" or self.backend.playing(session) != data["playing"]:
                    break
            await self._refresh()
        return self.snapshot()

    def control(self, command, expected):
        if command not in ("playpause", "previous", "next"):
            raise ValueError("Control de Spotify desconocido")
        self.start()
        if not self.ready.wait(self.timeout):
            raise ValueError("Spotify todavía está iniciando")
        future = asyncio.run_coroutine_threadsafe(asyncio.wait_for(self._control(command, expected), self.timeout + 1), self.loop)
        try:
            return future.result(self.timeout + 2)
        except (FutureTimeout, TimeoutError):
            future.cancel()
            raise ValueError("Spotify tardó demasiado. Esperá a que se actualice su estado.") from None
        except ValueError:
            raise
        except Exception:
            raise ValueError("No se pudo enviar el control a Spotify. Esperá su reconexión.") from None

    def close(self):
        if self.loop and not self.loop.is_closed():
            self.loop.call_soon_threadsafe(self.loop.stop)
            self.thread.join(timeout=self.timeout + 2)
