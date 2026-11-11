"""Small Windows control server with an editable, iOS 9 compatible dashboard."""
import ctypes
import base64
import json
import os
import re
import secrets
import socket
import threading
import time
import urllib.parse
import webbrowser
import xml.etree.ElementTree as ET
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

if not TOKEN_FILE.exists():
    TOKEN_FILE.write_text(secrets.token_hex(32), encoding="ascii")
TOKEN = TOKEN_FILE.read_text(encoding="ascii").strip()

DEFAULT = {
    "title": "Mi panel",
    "pages": [
        {"id": "inicio", "title": "Inicio", "height": 620, "backgroundColor": "#111827", "backgroundImage": "", "backgroundAnimation": "none", "buttons": [
            {"id": "mute", "label": "Mutear Discord", "x": 24, "y": 24, "w": 300, "h": 125, "backgroundColor": "#6d28d9", "textColor": "#ffffff", "radius": 18, "animation": "none", "icon": "", "image": "", "action": "hotkey", "value": "ctrl+shift+m", "feedback": {"mode": "toggle", "activeLabel": "🔇 Discord muteado", "activeColor": "#b91c1c", "activeIcon": ""}},
            {"id": "deafen", "label": "Ensordecer Discord", "x": 342, "y": 24, "w": 300, "h": 125, "backgroundColor": "#1d4ed8", "textColor": "#ffffff", "radius": 18, "animation": "none", "icon": "", "image": "", "action": "hotkey", "value": "ctrl+shift+d", "feedback": {"mode": "toggle", "activeLabel": "🔇 Discord ensordecido", "activeColor": "#b91c1c", "activeIcon": ""}},
            {"id": "google", "label": "Abrir Google", "x": 24, "y": 167, "w": 618, "h": 125, "backgroundColor": "#15803d", "textColor": "#ffffff", "radius": 18, "animation": "none", "icon": "", "image": "", "action": "url", "value": "https://www.google.com/"}
        ]}
    ]
}

if not CONFIG_FILE.exists():
    CONFIG_FILE.write_text(json.dumps(DEFAULT, indent=2, ensure_ascii=False), encoding="utf-8")

LOCK = threading.Lock()
ACTION_LOCK = threading.Lock()
BUTTON_STATES = {}
STATE_VERSION = [0]
STATE_EPOCH = secrets.token_hex(8)
PAIR_LOCK = threading.Lock()
PAIR_CODE = "%06d" % secrets.randbelow(1000000)
PAIR_ATTEMPTS = {}
PALETTE = {"purple": "#6d28d9", "blue": "#1d4ed8", "green": "#15803d", "orange": "#c2410c", "red": "#b91c1c", "gray": "#4b5563"}
ASSET_PATH = re.compile(r"^/assets/[a-f0-9]{32}\.(?:png|jpg|svg|gif)$")
SVG_TAGS = {"svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs", "linearGradient", "radialGradient", "stop", "clipPath"}
SVG_ATTRS = {"xmlns", "viewBox", "width", "height", "d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule", "opacity", "fill-opacity", "stroke-opacity", "transform", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "points", "id", "offset", "stop-color", "stop-opacity", "clip-path", "gradientUnits", "gradientTransform"}
MODIFIERS = {"ctrl": 0x11, "shift": 0x10, "alt": 0x12, "win": 0x5B}
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
    pages = []
    ids = set()
    for page in raw["pages"][:12]:
        if not isinstance(page, dict):
            continue
        pid = str(page.get("id", ""))[:40]
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", pid) or pid in ids:
            raise ValueError("ID de página inválido o repetido")
        ids.add(pid)
        height = integer(page.get("height"), 400, 1400, 620)
        buttons = []
        for position, button in enumerate(page.get("buttons", [])[:80]):
            if not isinstance(button, dict):
                continue
            bid = str(button.get("id", ""))[:40]
            if not re.fullmatch(r"[a-zA-Z0-9_-]+", bid) or bid in ids:
                raise ValueError("ID de botón inválido o repetido")
            ids.add(bid)
            action = str(button.get("action", ""))
            value = str(button.get("value", ""))[:500].strip()
            if action not in ("hotkey", "url"):
                raise ValueError("Acción desconocida")
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
                "mode": "toggle" if feedback.get("mode") == "toggle" else "none",
                "activeLabel": str(feedback.get("activeLabel") or "Activo")[:60],
                "activeColor": color(feedback.get("activeColor"), "#b91c1c"),
                "activeIcon": asset_path(feedback.get("activeIcon")),
            }
            legacy_wide = button.get("size") == "wide"
            fallback_x = 24 if legacy_wide else 24 + (position % 3) * 318
            fallback_y = 24 + (position // 2 if legacy_wide else position // 3) * 143
            w = integer(button.get("w"), 64, 1024, 618 if legacy_wide else 300)
            h = integer(button.get("h"), 50, height, 125)
            x = min(integer(button.get("x"), 0, 1024, fallback_x), 1024 - w)
            y = min(integer(button.get("y"), 0, height, fallback_y), height - h)
            buttons.append({"id": bid, "label": str(button.get("label", "Botón"))[:60],
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
                            "action": action, "value": value, "feedback": clean_feedback})
        pages.append({"id": pid, "title": str(page.get("title", "Página"))[:40], "height": height,
                      "backgroundColor": color(page.get("backgroundColor"), "#111827"),
                      "backgroundImage": asset_path(page.get("backgroundImage")),
                      "backgroundAnimation": page.get("backgroundAnimation") if page.get("backgroundAnimation") in ("none", "pan", "zoom") else "none",
                      "buttons": buttons})
    if not pages:
        raise ValueError("Debe existir al menos una página")
    return {"title": title, "pages": pages}


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


def send_hotkey(value):
    if os.name != "nt":
        raise RuntimeError("Los atajos requieren Windows")
    codes = [key_code(part) for part in value.lower().split("+")]
    user32 = ctypes.windll.user32
    for code in codes:
        user32.keybd_event(code, 0, 0, 0)
    time.sleep(0.035)
    for code in reversed(codes):
        user32.keybd_event(code, 0, 2, 0)


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
        if path == "/api/state":
            if not self.authorized():
                return self.json_response(401, {"error": "Clave incorrecta"})
            with ACTION_LOCK:
                return self.json_response(200, {"states": dict(BUTTON_STATES), "version": STATE_VERSION[0], "epoch": STATE_EPOCH})
        if path == "/api/assets":
            if not self.authorized() or self.client_address[0] not in ("127.0.0.1", "::1"):
                return self.json_response(403, {"error": "Disponible solo en el editor de esta PC"})
            return self.json_response(200, {"assets": list_assets()})
        assets = {"/": ("index.html", "text/html"), "/editor": ("editor.html", "text/html"),
                  "/style.css": ("style.css", "text/css"), "/app.js": ("app.js", "text/javascript"),
                  "/designer.js": ("designer.js", "text/javascript")}
        if path not in assets:
            return self.json_response(404, {"error": "No encontrado"})
        name, mime = assets[path]
        body = (ROOT / "public" / name).read_bytes()
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
            limit = 4000000 if path == "/api/assets" else 100000
            if size < 1 or size > limit:
                raise ValueError("Tamaño de solicitud inválido")
            data = json.loads(self.rfile.read(size).decode("utf-8"))
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
                if not button:
                    return self.json_response(404, {"error": "Botón inexistente"})
                with ACTION_LOCK:
                    if button["action"] == "hotkey":
                        send_hotkey(button["value"])
                    elif button["action"] == "url":
                        webbrowser.open(button["value"], new=2)
                    if button["feedback"]["mode"] == "toggle":
                        BUTTON_STATES[button["id"]] = not BUTTON_STATES.get(button["id"], False)
                        STATE_VERSION[0] += 1
                    states = dict(BUTTON_STATES)
                    version = STATE_VERSION[0]
                return self.json_response(200, {"ok": True, "states": states, "version": version, "epoch": STATE_EPOCH})
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
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Servidor detenido.")
    finally:
        server.server_close()
