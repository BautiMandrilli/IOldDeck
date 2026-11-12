"""Small Windows control server with an editable, iOS 9 compatible dashboard."""
import ctypes
import base64
import json
import io
import zipfile
import zlib
import os
import re
import secrets
import socket
import threading
import time
import urllib.parse
import webbrowser
import xml.etree.ElementTree as ET
from spotify_bridge import SpotifyService
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
TOKEN_FILE = DATA / "token.txt"
CONFIG_FILE = DATA / "config.json"
ASSET_DIR = DATA / "assets"
ASSET_INDEX = ASSET_DIR / "index.json"
PORT = 8765
DEV_RELOAD = os.environ.get("PANEL_DEV") == "1"
DEV_VERSION = secrets.token_hex(8)
SPOTIFY = SpotifyService()

if not TOKEN_FILE.exists():
    TOKEN_FILE.write_text(secrets.token_hex(32), encoding="ascii")
TOKEN = TOKEN_FILE.read_text(encoding="ascii").strip()

DEFAULT = {
    "title": "Mi panel",
    "pages": [
        {"id": "inicio", "title": "Inicio", "layout": "grid", "height": 620, "backgroundColor": "#111827", "backgroundImage": "", "backgroundAnimation": "none", "buttons": [
            {"id": "mute", "label": "Mutear Discord", "x": 24, "y": 24, "w": 300, "h": 125, "backgroundColor": "#6d28d9", "textColor": "#ffffff", "radius": 18, "animation": "none", "icon": "", "image": "", "action": "hotkey", "value": "ctrl+shift+m", "feedback": {"mode": "toggle", "activeLabel": "🔇 Discord muteado", "activeColor": "#b91c1c", "activeIcon": ""}},
            {"id": "deafen", "label": "Ensordecer Discord", "x": 342, "y": 24, "w": 300, "h": 125, "backgroundColor": "#1d4ed8", "textColor": "#ffffff", "radius": 18, "animation": "none", "icon": "", "image": "", "action": "hotkey", "value": "ctrl+shift+d", "feedback": {"mode": "toggle", "activeLabel": "🔇 Discord ensordecido", "activeColor": "#b91c1c", "activeIcon": ""}},
            {"id": "google", "label": "Abrir Google", "x": 24, "y": 167, "w": 618, "h": 125, "backgroundColor": "#15803d", "textColor": "#ffffff", "radius": 18, "animation": "none", "icon": "", "image": "", "action": "url", "value": "https://www.google.com/"}
        ]}
    ]
}

if not CONFIG_FILE.exists():
    CONFIG_FILE.write_text(json.dumps(DEFAULT, indent=2, ensure_ascii=False), encoding="utf-8")

LOCK = threading.RLock()
ACTION_LOCK = threading.Lock()
BUTTON_STATES = {}
STATE_VERSION = [0]
STATE_EPOCH = secrets.token_hex(8)
PAIR_LOCK = threading.Lock()
PAIR_CODE = "%06d" % secrets.randbelow(1000000)
PAIR_ATTEMPTS = {}
PALETTE = {"purple": "#6d28d9", "blue": "#1d4ed8", "green": "#15803d", "orange": "#c2410c", "red": "#b91c1c", "gray": "#4b5563"}
ASSET_PATH = re.compile(r"^/assets/[a-f0-9]{32}\.(?:png|jpg|svg|gif)$")
BUILTIN_ICONS = {"", "grid", "mic", "headphones", "play", "pause", "music", "volume", "home", "globe", "power", "star", "monitor", "keyboard", "camera", "settings", "bell"}
SVG_TAGS = {"svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs", "linearGradient", "radialGradient", "stop", "clipPath"}
SVG_ATTRS = {"xmlns", "viewBox", "width", "height", "d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule", "opacity", "fill-opacity", "stroke-opacity", "transform", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "points", "id", "offset", "stop-color", "stop-opacity", "clip-path", "gradientUnits", "gradientTransform"}
# Left-hand modifier keys, as a physical keyboard reports them.
MODIFIERS = {"ctrl": 0xA2, "shift": 0xA0, "alt": 0xA4, "win": 0x5B}
SPECIAL = {"enter": 0x0D, "tab": 0x09, "esc": 0x1B, "space": 0x20, "backspace": 0x08,
           "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28, "delete": 0x2E}


def config():
    with LOCK:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))


def color(value, fallback):
    value = str(value or "")
    return value if re.fullmatch(r"#[0-9a-fA-F]{6}", value) else fallback


def asset_path(value):
    value = str(value or "")
    if value and not ASSET_PATH.fullmatch(value):
        raise ValueError("Imagen inválida; cargala desde el editor")
    return value


def integer(value, low, high, fallback):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return fallback


def safe_svg(raw):
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("SVG no permitido")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ValueError("SVG inválido") from exc
    namespace = "http://www.w3.org/2000/svg"
    if root.tag != "{%s}svg" % namespace:
        raise ValueError("El archivo no es un SVG")
    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag not in SVG_TAGS or not element.tag.startswith("{%s}" % namespace):
            raise ValueError("El SVG contiene elementos no permitidos")
        for key, value in element.attrib.items():
            attr = key.rsplit("}", 1)[-1]
            if key.startswith("{") or attr not in SVG_ATTRS or re.search(r"(?:https?:|javascript:|data:|@import)", value, re.I):
                raise ValueError("El SVG contiene atributos no permitidos")
            if "url(" in value.lower() and not re.fullmatch(r"url\(#[a-zA-Z0-9_-]+\)", value.strip()):
                raise ValueError("Referencia externa en SVG")
    ET.register_namespace("", namespace)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def list_assets():
    if not ASSET_INDEX.exists():
        return []
    return json.loads(ASSET_INDEX.read_text(encoding="utf-8"))


def validate(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("pages"), list):
        raise ValueError("Configuración inválida")
    title = str(raw.get("title", "Mi panel"))[:60].strip() or "Mi panel"
    if raw.get("version", 1) not in (1, 2, 3):
        raise ValueError("Versión de configuración no compatible")
    if len(raw["pages"]) > 12:
        raise ValueError("Máximo 12 páginas")
    pages = []
    ids = set()
    for page in raw["pages"][:12]:
        if not isinstance(page, dict):
            raise ValueError("Página inválida")
        pid = str(page.get("id", ""))[:40]
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", pid) or pid in ids:
            raise ValueError("ID de página inválido o repetido")
        ids.add(pid)
        height = integer(page.get("height"), 400, 1400, 620)
        buttons = []
        if not isinstance(page.get("buttons", []), list) or len(page.get("buttons", [])) > 80:
            raise ValueError("Máximo 80 elementos por página")
        for position, button in enumerate(page.get("buttons", [])[:80]):
            if not isinstance(button, dict):
                raise ValueError("Botón inválido")
            bid = str(button.get("id", ""))[:40]
            if not re.fullmatch(r"[a-zA-Z0-9_-]+", bid) or bid in ids:
                raise ValueError("ID de botón inválido o repetido")
            ids.add(bid)
            kind = button.get("type", "button")
            if kind not in ("button", "folder", "spotify"):
                raise ValueError("Tipo de elemento desconocido")
            parent = str(button.get("folderId", ""))
            display_mode = button.get("displayMode", "both")
            builtin_icon = button.get("builtinIcon", "")
            # "app:<slug>" refers to the app logo library in public/app-icons.js.
            if display_mode not in ("label", "icon", "both") or not isinstance(builtin_icon, str) or (
                    builtin_icon not in BUILTIN_ICONS and not re.fullmatch(r"app:[a-z0-9]{1,40}", builtin_icon)):
                raise ValueError("Presentación o icono inválido")
            if kind == "folder" and parent:
                raise ValueError("No se permiten subcarpetas")
            action = kind if kind in ("folder", "spotify") else str(button.get("action", ""))
            value = str(button.get("value", ""))[:500].strip()
            if action not in ("hotkey", "url", "app", "folder", "spotify") or (kind == "button" and action in ("folder", "spotify")):
                raise ValueError("Acción desconocida")
            if action == "app" and value not in DESKTOP_APPS:
                raise ValueError("App de la PC desconocida: " + value)
            if action == "url" and (urllib.parse.urlparse(value).scheme not in ("http", "https") or not urllib.parse.urlparse(value).netloc):
                raise ValueError("La página debe comenzar con http:// o https://")
            if action == "hotkey" and not valid_hotkey(value):
                raise ValueError("Atajo inválido: " + value)
            feedback = button.get("feedback")
            if not isinstance(feedback, dict):
                if bid == "mute" and action == "hotkey" and value == "ctrl+shift+m":
                    feedback = {"mode": "toggle", "activeLabel": "🔇 Discord muteado"}
                elif bid == "deafen" and action == "hotkey" and value == "ctrl+shift+d":
                    feedback = {"mode": "toggle", "activeLabel": "🔇 Discord ensordecido"}
                else:
                    feedback = {}
            clean_feedback = {
                "mode": "toggle" if kind == "button" and feedback.get("mode") == "toggle" else "none",
                "activeLabel": str(feedback.get("activeLabel") or "Activo")[:60],
                "activeColor": color(feedback.get("activeColor"), "#b91c1c"),
                "activeIcon": asset_path(feedback.get("activeIcon")),
            }
            legacy_wide = button.get("size") == "wide"
            fallback_x = 24 if legacy_wide else 24 + (position % 3) * 318
            fallback_y = 24 + (position // 2 if legacy_wide else position // 3) * 143
            w = integer(button.get("w"), 320 if kind == "spotify" else 64, 1024, 646 if kind == "spotify" else (618 if legacy_wide else 300))
            h = integer(button.get("h"), 220 if kind == "spotify" else 50, height, 280 if kind == "spotify" else 125)
            x = min(integer(button.get("x"), 0, 1024, fallback_x), 1024 - w)
            y = min(integer(button.get("y"), 0, height, fallback_y), height - h)
            buttons.append({"id": bid, "label": str(button.get("label", "Botón"))[:60],
                            "displayMode": display_mode, "builtinIcon": builtin_icon,
                            "type": kind, "folderId": parent,
                            "cols": integer(button.get("cols"), 3 if kind == "spotify" else 1, 6, 4 if kind == "spotify" else 1),
                            "rows": integer(button.get("rows"), 2 if kind == "spotify" else 1, 4, 2 if kind == "spotify" else 1),
                            "x": x, "y": y, "w": w, "h": h,
                            "backgroundColor": color(button.get("backgroundColor"), PALETTE.get(str(button.get("color")), "#1d4ed8")),
                            "textColor": color(button.get("textColor"), "#ffffff"),
                            "borderColor": color(button.get("borderColor"), "#ffffff"),
                            "borderWidth": integer(button.get("borderWidth"), 0, 8, 1),
                            "radius": integer(button.get("radius"), 0, 80, 18),
                            "fontSize": integer(button.get("fontSize"), 12, 48, 20),
                            "iconSize": integer(button.get("iconSize"), 20, 120, 52),
                            "opacity": integer(button.get("opacity"), 30, 100, 100),
                            "textAlign": button.get("textAlign") if button.get("textAlign") in ("left", "center", "right") else "center",
                            "animation": button.get("animation") if button.get("animation") in ("none", "pulse", "float", "glow") else "none",
                            "icon": asset_path(button.get("icon")), "image": asset_path(button.get("image")),
                            "action": action, "value": "" if kind in ("folder", "spotify") else value, "feedback": clean_feedback})
        folders = {b["id"] for b in buttons if b["type"] == "folder"}
        if any(b["folderId"] and b["folderId"] not in folders for b in buttons):
            raise ValueError("La carpeta debe existir en la misma página")
        pages.append({"id": pid, "title": str(page.get("title", "Página"))[:40], "height": height,
                      "layout": "grid" if page.get("layout") == "grid" else "free",
                      "backgroundColor": color(page.get("backgroundColor"), "#111827"),
                      "backgroundImage": asset_path(page.get("backgroundImage")),
                      "backgroundAnimation": page.get("backgroundAnimation") if page.get("backgroundAnimation") in ("none", "pan", "zoom") else "none",
                      "buttons": buttons})
    if not pages:
        raise ValueError("Debe existir al menos una página")
    return {"version": 3, "title": title, "pages": pages}


MAX_CONFIG = 2000000
MAX_BACKUP = 505000000


def image_bytes(raw, mime):
    if not raw or len(raw) > 2500000:
        raise ValueError("La imagen debe pesar menos de 2,5 MB")
    signatures = {"image/png": (b"\x89PNG\r\n\x1a\n",), "image/jpeg": (b"\xff\xd8",),
                  "image/gif": (b"GIF87a", b"GIF89a")}
    if mime == "image/svg+xml":
        return safe_svg(raw)
    if mime not in signatures or not raw.startswith(signatures[mime]):
        raise ValueError("Imagen inválida")
    return raw


def referenced_assets(cfg):
    paths = set()
    for p in cfg["pages"]:
        paths.add(p["backgroundImage"])
        for b in p["buttons"]:
            paths.update((b["image"], b["icon"], b["feedback"]["activeIcon"]))
    return paths - {""}


def backup_bytes():
    with LOCK:
        cfg = validate(config())
        assets = list_assets()
        if not referenced_assets(cfg).issubset({a["url"] for a in assets}):
            raise ValueError("Faltan imágenes de la configuración")
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("config.json", json.dumps(cfg, ensure_ascii=False))
            archive.writestr("assets/index.json", json.dumps(assets, ensure_ascii=False))
            for item in assets:
                url = asset_path(item["url"])
                archive.writestr(url.lstrip("/"), (DATA / url.lstrip("/")).read_bytes())
        return output.getvalue()


def read_backup(body):
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            entries = archive.infolist()
            names = [i.filename for i in entries]
            if len(entries) > 202 or len(names) != len(set(names)) or sum(i.file_size for i in entries) > MAX_BACKUP:
                raise ValueError("Respaldo demasiado grande o con archivos repetidos")
            for entry in entries:
                allowed = entry.filename in ("config.json", "assets/index.json") or ASSET_PATH.fullmatch("/" + entry.filename)
                limit = MAX_CONFIG if entry.filename.endswith(".json") else 2500000
                if not allowed or entry.file_size > limit or entry.flag_bits & 1:
                    raise ValueError("Archivo no permitido en el respaldo")
            cfg = validate(json.loads(archive.read("config.json")))
            assets = json.loads(archive.read("assets/index.json"))
            if not isinstance(assets, list) or len(assets) > 200:
                raise ValueError("Índice de imágenes inválido")
            clean_assets, files, urls = [], {}, set()
            mimes = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "svg": "image/svg+xml"}
            for item in assets:
                url = asset_path(item["url"])
                if not url or url in urls:
                    raise ValueError("Imagen repetida o inválida")
                mime = mimes[url.rsplit(".", 1)[1]]
                if item.get("mime") != mime:
                    raise ValueError("Tipo de imagen inválido")
                files[url] = image_bytes(archive.read(url.lstrip("/")), mime)
                urls.add(url)
                clean_assets.append({"url": url, "mime": mime, "name": str(item.get("name", "Imagen"))[:100]})
            if not referenced_assets(cfg).issubset(urls):
                raise ValueError("Faltan imágenes referenciadas")
            if set(names) != {"config.json", "assets/index.json"} | {u.lstrip("/") for u in urls}:
                raise ValueError("El respaldo contiene archivos fuera del índice")
            return cfg, clean_assets, files
    except (zipfile.BadZipFile, zipfile.LargeZipFile, zlib.error, EOFError, KeyError, TypeError, AttributeError, UnicodeError, RuntimeError, NotImplementedError) as exc:
        raise ValueError("Respaldo ZIP inválido o incompleto") from exc


def restore_backup(prepared):
    cfg, assets, files = prepared
    # Install images with fresh names first; the active config never sees missing files.
    with LOCK:
        previous = backup_bytes()
        backup = DATA / ("before-restore-" + time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(4) + ".zip")
        backup.write_bytes(previous)
        old_config = CONFIG_FILE.read_bytes()
        old_index = ASSET_INDEX.read_bytes() if ASSET_INDEX.exists() else None
        created = []
        try:
            ASSET_DIR.mkdir(exist_ok=True)
            mapping = {}
            for url, raw in files.items():
                name = secrets.token_hex(16) + "." + url.rsplit(".", 1)[1]
                target = ASSET_DIR / name
                target.write_bytes(raw)
                created.append(target)
                mapping[url] = "/assets/" + name
            for item in assets:
                item["url"] = mapping[item["url"]]
            for p in cfg["pages"]:
                p["backgroundImage"] = mapping.get(p["backgroundImage"], "")
                for b in p["buttons"]:
                    for key in ("image", "icon"):
                        b[key] = mapping.get(b[key], "")
                    b["feedback"]["activeIcon"] = mapping.get(b["feedback"]["activeIcon"], "")
            temp_index = ASSET_INDEX.with_suffix(".tmp")
            temp_index.write_text(json.dumps(assets, ensure_ascii=False), encoding="utf-8")
            temp_config = CONFIG_FILE.with_suffix(".tmp")
            temp_config.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
            temp_index.replace(ASSET_INDEX)
            temp_config.replace(CONFIG_FILE)
        except Exception:
            CONFIG_FILE.write_bytes(old_config)
            if old_index is None:
                ASSET_INDEX.unlink(missing_ok=True)
            else:
                ASSET_INDEX.write_bytes(old_index)
            for target in created:
                target.unlink(missing_ok=True)
            raise
    with ACTION_LOCK:
        BUTTON_STATES.clear()
        STATE_VERSION[0] += 1
    return {"config": cfg, "backup": backup.name}


def valid_hotkey(value):
    parts = value.lower().split("+")
    if not 1 <= len(parts) <= 5 or len(parts) != len(set(parts)):
        return False
    return all(part in MODIFIERS or part in SPECIAL or re.fullmatch(r"[a-z0-9]", part) or re.fullmatch(r"f(?:[1-9]|1[0-2])", part) for part in parts)


def key_code(part):
    if part in MODIFIERS:
        return MODIFIERS[part]
    if part in SPECIAL:
        return SPECIAL[part]
    if re.fullmatch(r"f(?:[1-9]|1[0-2])", part):
        return 0x70 + int(part[1:]) - 1
    return ord(part.upper())


def scan_code(vk):
    return ctypes.windll.user32.MapVirtualKeyW(vk, 4)  # MAPVK_VK_TO_VSC_EX: 0xE0xx for extended keys


def hotkey_events(value, scan=scan_code):
    """Key presses in order, then releases in reverse, as (virtual key, scan code, flags).
    Apps with global shortcuts (Discord, OBS, games) match on the hardware scan code, so
    events without it (scan 0) are ignored even though Windows knows the virtual key."""
    downs = []
    for part in value.lower().split("+"):
        vk = key_code(part)
        code = scan(vk)
        downs.append((vk, code & 0xFF, 1 if code & 0xFF00 in (0xE000, 0xE100) else 0))  # KEYEVENTF_EXTENDEDKEY
    return downs + [(vk, code, flags | 2) for vk, code, flags in reversed(downs)]  # KEYEVENTF_KEYUP


def send_hotkey(value):
    if os.name != "nt":
        raise RuntimeError("Los atajos requieren Windows")
    user32 = ctypes.windll.user32
    events = hotkey_events(value)
    last_down = len(events) // 2 - 1
    for index, (vk, code, flags) in enumerate(events):
        user32.keybd_event(vk, code, flags, 0)
        # Short gaps between keys and a ~60 ms hold, like a person pressing the combination.
        time.sleep(0.06 if index == last_down else 0.012)


# Desktop apps that register a link type in Windows: opening that link launches the
# installed app instead of the browser. Fixed list on purpose — the panel never opens
# arbitrary URI schemes, since some Windows handlers can run code.
# slug: (name, registry scheme, link that opens the app, web fallback,
#        process names that own its main window, exact main-window title or None)
DESKTOP_APPS = {
    "discord": ("Discord", "discord", "discord://-/", "https://discord.com/app", ("discord.exe", "discordptb.exe", "discordcanary.exe"), None),
    "spotify": ("Spotify", "spotify", "spotify:", "https://open.spotify.com/", ("spotify.exe",), None),
    "steam": ("Steam", "steam", "steam://open/main", "https://store.steampowered.com/", ("steamwebhelper.exe", "steam.exe"), "Steam"),
    "epicgames": ("Epic Games", "com.epicgames.launcher", "com.epicgames.launcher://store", "https://store.epicgames.com/", ("epicgameslauncher.exe",), None),
    "telegram": ("Telegram", "tg", "tg://", "https://web.telegram.org/", ("telegram.exe",), None),
    "whatsapp": ("WhatsApp", "whatsapp", "whatsapp://", "https://web.whatsapp.com/", ("whatsapp.exe", "whatsapp.root.exe"), None),
    "zoom": ("Zoom", "zoommtg", "zoommtg://", "https://app.zoom.us/", ("zoom.exe",), None),
    "notion": ("Notion", "notion", "notion://", "https://www.notion.so/", ("notion.exe",), None),
    "figma": ("Figma", "figma", "figma://", "https://www.figma.com/", ("figma.exe",), None),
    "claude": ("Claude", "claude", "claude://", "https://claude.ai/", ("claude.exe",), None),
}


def app_installed(scheme):
    if os.name != "nt":
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, scheme) as key:
            winreg.QueryValueEx(key, "URL Protocol")
        return True
    except OSError:
        return False


def launch_uri(uri):
    os.startfile(uri)


def _process_name(hwnd):
    from ctypes import wintypes
    pid = wintypes.DWORD()
    ctypes.windll.user32.GetWindowThreadProcessId(wintypes.HWND(hwnd), ctypes.byref(pid))
    kernel32 = ctypes.windll.kernel32
    kernel32.OpenProcess.restype = wintypes.HANDLE
    handle = kernel32.OpenProcess(0x1000, False, pid.value)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return ""
    try:
        size = wintypes.DWORD(1024)
        buffer = ctypes.create_unicode_buffer(size.value)
        if not kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            return ""
        return os.path.basename(buffer.value).lower()
    finally:
        kernel32.CloseHandle(handle)


class _WindowPlacement(ctypes.Structure):
    _fields_ = [("length", ctypes.c_uint), ("flags", ctypes.c_uint), ("showCmd", ctypes.c_uint),
                ("minPosition", ctypes.c_long * 2), ("maxPosition", ctypes.c_long * 2),
                ("normalPosition", ctypes.c_long * 4)]


def find_app_window(exe_names, title=None):
    """Largest visible top-level window (minimized included) owned by one of exe_names."""
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def visit(raw, _param):
        hwnd = wintypes.HWND(raw)
        if not user32.IsWindowVisible(hwnd) or user32.GetWindow(hwnd, 4):  # skip hidden and owned windows
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if not length:
            return True
        text = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, text, length + 1)
        if (title and text.value != title) or _process_name(raw) not in exe_names:
            return True
        placement = _WindowPlacement()
        placement.length = ctypes.sizeof(placement)
        user32.GetWindowPlacement(hwnd, ctypes.byref(placement))
        left, top, right, bottom = placement.normalPosition
        found.append(((right - left) * (bottom - top), raw))
        return True

    user32.EnumWindows(visit, 0)
    return max(found)[1] if found else None


def bring_to_front(hwnd):
    """Restores a minimized window and puts it in front of the user."""
    from ctypes import wintypes
    user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
    user32.GetForegroundWindow.restype = wintypes.HWND
    target = wintypes.HWND(hwnd)
    user32.ShowWindow(target, 9 if user32.IsIconic(target) else 5)  # SW_RESTORE / SW_SHOW
    # Windows only lets the foreground app hand over focus. Borrow its input queue for a moment.
    foreground = user32.GetForegroundWindow()
    current = kernel32.GetCurrentThreadId()
    other = user32.GetWindowThreadProcessId(wintypes.HWND(foreground), None) if foreground else 0
    attached = bool(other and other != current and user32.AttachThreadInput(current, other, True))
    try:
        user32.BringWindowToTop(target)
        user32.SetForegroundWindow(target)
    finally:
        if attached:
            user32.AttachThreadInput(current, other, False)
    if user32.GetForegroundWindow() != hwnd:
        # Fallback: a synthetic Alt tap counts as the latest input, which unlocks SetForegroundWindow.
        user32.keybd_event(0x12, 0, 0, 0)
        user32.keybd_event(0x12, 0, 2, 0)
        user32.SetForegroundWindow(target)


def bring_app_forward(slug):
    """In the background, waits for the app's main window and brings it to the front.
    Already running: done within a second. Starting up: keeps up with the splash and
    main window for a few seconds, but never refocuses a window it already raised."""
    if os.name != "nt":
        return
    exes, title = DESKTOP_APPS[slug][4], DESKTOP_APPS[slug][5]

    def work():
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        user32.GetForegroundWindow.restype = wintypes.HWND
        running = find_app_window(exes, title) is not None
        deadline = time.time() + (3 if running else 15)
        raised = set()
        time.sleep(0.3)
        while time.time() < deadline:
            try:
                hwnd = find_app_window(exes, title)
                if hwnd and hwnd not in raised:
                    raised.add(hwnd)
                    bring_to_front(hwnd)
                    if running:
                        return
            except OSError:
                pass
            time.sleep(0.25)

    threading.Thread(target=work, name="bring-" + slug, daemon=True).start()


def open_app(slug):
    """Opens the desktop app when installed, otherwise its website. Returns "app" or "web"."""
    scheme, uri, web = DESKTOP_APPS[slug][1:4]
    if app_installed(scheme):
        launch_uri(uri)
        bring_app_forward(slug)
        return "app"
    webbrowser.open(web, new=2)
    return "web"


def desktop_apps():
    return [{"slug": slug, "name": item[0], "installed": app_installed(item[1]), "web": item[3]}
            for slug, item in DESKTOP_APPS.items()]


def local_ip():
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("192.0.2.1", 1))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except OSError:
        return "IP-DE-TU-PC"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("%s %s" % (self.address_string(), fmt % args))

    def json_response(self, code, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        supplied = self.headers.get("X-Panel-Token", "")
        return secrets.compare_digest(supplied, TOKEN)

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path in ("/api/spotify/state", "/api/spotify/artwork"):
            if not self.authorized():
                return self.json_response(401, {"error": "Clave incorrecta"})
            if path.endswith("/state"):
                return self.json_response(200, SPOTIFY.snapshot())
            revision = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("revision", [""])[0]
            art = SPOTIFY.artwork(revision)
            if art is None:
                return self.json_response(404, {"error": "Carátula no disponible"})
            body, mime = art
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/backup":
            if not self.authorized() or self.client_address[0] not in ("127.0.0.1", "::1"):
                return self.json_response(403, {"error": "Disponible solo en el editor de esta PC"})
            try:
                body = backup_bytes()
            except (ValueError, OSError) as exc:
                return self.json_response(400, {"error": str(exc)})
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", 'attachment; filename="mi-panel.zip"')
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if ASSET_PATH.fullmatch(path):
            filename = path.rsplit("/", 1)[-1]
            file = ASSET_DIR / filename
            if not file.is_file():
                return self.json_response(404, {"error": "Imagen no encontrada"})
            body = file.read_bytes()
            mime = {"png": "image/png", "jpg": "image/jpeg", "svg": "image/svg+xml", "gif": "image/gif"}[file.suffix[1:]]
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/local-token":
            if self.client_address[0] not in ("127.0.0.1", "::1"):
                return self.json_response(403, {"error": "Disponible solo en esta computadora"})
            return self.json_response(200, {"token": TOKEN})
        if path == "/api/config":
            if not self.authorized():
                return self.json_response(401, {"error": "Clave incorrecta"})
            return self.json_response(200, validate(config()))
        if path == "/api/dev-version":
            if not self.authorized():
                return self.json_response(401, {"error": "Clave incorrecta"})
            return self.json_response(200, {"version": DEV_VERSION if DEV_RELOAD else None})
        if path == "/api/state":
            if not self.authorized():
                return self.json_response(401, {"error": "Clave incorrecta"})
            with ACTION_LOCK:
                return self.json_response(200, {"states": dict(BUTTON_STATES), "version": STATE_VERSION[0], "epoch": STATE_EPOCH})
        if path == "/api/desktop-apps":
            if not self.authorized() or self.client_address[0] not in ("127.0.0.1", "::1"):
                return self.json_response(403, {"error": "Disponible solo en el editor de esta PC"})
            return self.json_response(200, {"apps": desktop_apps()})
        if path == "/api/assets":
            if not self.authorized() or self.client_address[0] not in ("127.0.0.1", "::1"):
                return self.json_response(403, {"error": "Disponible solo en el editor de esta PC"})
            return self.json_response(200, {"assets": list_assets()})
        assets = {"/": ("index.html", "text/html"), "/editor": ("editor.html", "text/html"),
                  "/style.css": ("style.css", "text/css"), "/app.js": ("app.js", "text/javascript"),
                  "/designer.js": ("designer.js", "text/javascript"),
                  "/layout.js": ("layout.js", "text/javascript"),
                  "/dev-reload.js": ("dev-reload.js", "text/javascript")}
        assets["/spotify.js"] = ("spotify.js", "text/javascript")
        assets["/motion.js"] = ("motion.js", "text/javascript")
        assets["/app-icons.js"] = ("app-icons.js", "text/javascript")
        assets["/editor.css"] = ("editor.css", "text/css")
        if path not in assets:
            return self.json_response(404, {"error": "No encontrado"})
        name, mime = assets[path]
        body = (ROOT / "public" / name).read_bytes()
        if DEV_RELOAD and name.endswith(".html"):
            script = '<script>window.panelDevVersion=' + json.dumps(DEV_VERSION) + ';</script><script src="/dev-reload.js"></script>'
            body = body.replace(b"</body>", script.encode("utf-8") + b"</body>")
        self.send_response(200)
        self.send_header("Content-Type", mime + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        if path != "/api/pair" and not self.authorized():
            return self.json_response(401, {"error": "Clave incorrecta"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if path == "/api/restore":
                if self.client_address[0] not in ("127.0.0.1", "::1"):
                    return self.json_response(403, {"error": "Restaurar solo desde esta computadora"})
                if size < 1 or size > MAX_BACKUP:
                    raise ValueError("Respaldo demasiado grande (máximo 505 MB)")
                prepared = read_backup(self.rfile.read(size))
                if urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("preview") == ["1"]:
                    cfg = prepared[0]
                    items = [b for p in cfg["pages"] for b in p["buttons"]]
                    return self.json_response(200, {"title": cfg["title"], "pages": len(cfg["pages"]),
                        "folders": sum(b["type"] == "folder" for b in items),
                        "widgets": sum(b["type"] == "spotify" for b in items),
                        "buttons": sum(b["type"] == "button" for b in items)})
                return self.json_response(200, restore_backup(prepared))
            limit = 4000000 if path == "/api/assets" else MAX_CONFIG
            if size < 1 or size > limit:
                raise ValueError("Tamaño de solicitud inválido")
            data = json.loads(self.rfile.read(size).decode("utf-8"))
            if path == "/api/spotify/control":
                if not isinstance(data, dict):
                    raise ValueError("Control inválido")
                return self.json_response(200, SPOTIFY.control(data.get("command"), data.get("sessionId")))
            if path == "/api/pair":
                ip = self.client_address[0]
                code = str(data.get("code", "")) if isinstance(data, dict) else ""
                with PAIR_LOCK:
                    now = time.monotonic()
                    attempts = [when for when in PAIR_ATTEMPTS.get(ip, []) if now - when < 300]
                    if len(attempts) >= 5:
                        return self.json_response(429, {"error": "Demasiados intentos. Esperá 5 minutos."})
                    attempts.append(now)
                    PAIR_ATTEMPTS[ip] = attempts
                    if not secrets.compare_digest(code, PAIR_CODE):
                        return self.json_response(401, {"error": "Código incorrecto"})
                    PAIR_ATTEMPTS.pop(ip, None)
                return self.json_response(200, {"token": TOKEN})
            if path == "/api/config":
                if self.client_address[0] not in ("127.0.0.1", "::1"):
                    return self.json_response(403, {"error": "Editar solo desde esta computadora"})
                clean = validate(data)
                with LOCK:
                    temp = CONFIG_FILE.with_suffix(".tmp")
                    temp.write_text(json.dumps(clean, indent=2, ensure_ascii=False), encoding="utf-8")
                    temp.replace(CONFIG_FILE)
                with ACTION_LOCK:
                    active_ids = {b["id"] for p in clean["pages"] for b in p["buttons"] if b["feedback"]["mode"] == "toggle"}
                    for old_id in list(BUTTON_STATES):
                        if old_id not in active_ids:
                            BUTTON_STATES.pop(old_id, None)
                            STATE_VERSION[0] += 1
                return self.json_response(200, clean)
            if path == "/api/assets":
                if self.client_address[0] not in ("127.0.0.1", "::1"):
                    return self.json_response(403, {"error": "Cargar imágenes solo desde esta computadora"})
                if not isinstance(data, dict) or data.get("mime") not in ("image/png", "image/jpeg", "image/svg+xml", "image/gif"):
                    raise ValueError("Usá un archivo PNG, JPG, SVG o GIF")
                try:
                    raw = base64.b64decode(data.get("base64", ""), validate=True)
                except (ValueError, TypeError) as exc:
                    raise ValueError("Archivo inválido") from exc
                if not raw or len(raw) > 2500000:
                    raise ValueError("La imagen debe pesar menos de 2,5 MB")
                mime = data["mime"]
                if mime == "image/png" and not raw.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ValueError("PNG inválido")
                if mime == "image/jpeg" and not raw.startswith(b"\xff\xd8"):
                    raise ValueError("JPG inválido")
                if mime == "image/gif" and not raw.startswith((b"GIF87a", b"GIF89a")):
                    raise ValueError("GIF inválido")
                if mime == "image/svg+xml":
                    raw = safe_svg(raw)
                ext = {"image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "image/gif": "gif"}[mime]
                name = secrets.token_hex(16) + "." + ext
                url = "/assets/" + name
                with LOCK:
                    assets = list_assets()
                    if len(assets) >= 200:
                        raise ValueError("Límite de 200 imágenes alcanzado")
                    ASSET_DIR.mkdir(exist_ok=True)
                    (ASSET_DIR / name).write_bytes(raw)
                    item = {"name": str(data.get("name", "Imagen"))[:100], "url": url, "mime": mime}
                    assets.append(item)
                    ASSET_INDEX.write_text(json.dumps(assets, ensure_ascii=False, indent=2), encoding="utf-8")
                return self.json_response(200, item)
            if path == "/api/action":
                cfg = validate(config())
                button = next((b for p in cfg["pages"] for b in p["buttons"] if b["id"] == data.get("id")), None)
                if not button or button["type"] != "button":
                    return self.json_response(404, {"error": "Botón inexistente"})
                opened = None
                with ACTION_LOCK:
                    if button["action"] == "hotkey":
                        send_hotkey(button["value"])
                    elif button["action"] == "url":
                        webbrowser.open(button["value"], new=2)
                    elif button["action"] == "app":
                        opened = open_app(button["value"])
                    if button["feedback"]["mode"] == "toggle":
                        BUTTON_STATES[button["id"]] = not BUTTON_STATES.get(button["id"], False)
                        STATE_VERSION[0] += 1
                    states = dict(BUTTON_STATES)
                    version = STATE_VERSION[0]
                return self.json_response(200, {"ok": True, "states": states, "version": version, "epoch": STATE_EPOCH, "opened": opened})
            return self.json_response(404, {"error": "No encontrado"})
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            return self.json_response(400, {"error": str(exc)})
        except Exception as exc:
            return self.json_response(500, {"error": str(exc)})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("Editor en la PC: http://localhost:%d/editor" % PORT)
    print("iPad: http://%s:%d" % (local_ip(), PORT))
    print("Código para vincular el iPad: %s" % PAIR_CODE)
    print("Presioná Ctrl+C para detener.")
    if DEV_RELOAD:
        print("Desarrollo: recarga automática activada en el panel y el editor.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Servidor detenido.")
    finally:
        SPOTIFY.close()
        server.server_close()
