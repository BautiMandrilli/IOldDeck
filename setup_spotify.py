"""Add the first-page Spotify test card once, without moving existing elements."""
import copy
import json
import secrets
import socket
import time
from pathlib import Path


def add_card(raw, validate):
    cfg = validate(copy.deepcopy(raw))
    page = cfg["pages"][0]
    if any(b["type"] == "spotify" for b in page["buttons"]):
        return cfg, False
    if len(page["buttons"]) >= 80:
        raise ValueError("La primera página ya tiene 80 elementos. Liberá un lugar desde el editor.")
    visible = [b for b in page["buttons"] if not b["folderId"]]
    x, y, w, h = 24, 316, 646, 280

    def available(x, y):
        return all(x + w <= b["x"] or x >= b["x"] + b["w"] or y + h <= b["y"] or y >= b["y"] + b["h"] for b in visible)

    if page["layout"] == "free":
        if not available(x, y):
            # Candidate edges preserve all existing positions and avoid pixel-by-pixel scans.
            xs = sorted({24} | {b["x"] + b["w"] + 24 for b in visible})
            ys = sorted({24} | {b["y"] + b["h"] + 24 for b in visible})
            spot = next(((cx, cy) for cy in ys for cx in xs if cx + w <= 1000 and cy + h + 24 <= 1400 and available(cx, cy)), None)
            if spot is None:
                raise ValueError("No hay espacio libre para la tarjeta. Reordená la primera página e intentá nuevamente.")
            x, y = spot
        page["height"] = max(page["height"], y + h + 24)
    page["buttons"].append({"id": "spotify_" + secrets.token_hex(6), "type": "spotify", "label": "Spotify",
        "action": "spotify", "folderId": "", "cols": 4, "rows": 2, "x": x, "y": y, "w": w, "h": h,
        "backgroundColor": "#1c1c1e", "textColor": "#ffffff", "borderColor": "#38383a", "borderWidth": 1, "radius": 28})
    return validate(cfg), True


def main():
    # Import after checking the port: never race an active editor/server.
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", 8765)) == 0:
            raise ValueError("Detené el servidor (Ctrl+C) antes de preparar la tarjeta. Después iniciá npm run dev.")
    import server
    cfg, added = add_card(server.config(), server.validate)
    if not added:
        print("La primera página ya tiene una tarjeta Spotify. No se agregó otra.")
        return
    backup = server.DATA / ("before-spotify-" + time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(4) + ".zip")
    backup.write_bytes(server.backup_bytes())
    temp = server.CONFIG_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(server.CONFIG_FILE)
    print("Tarjeta Spotify agregada a la primera página.")
    print("Respaldo anterior: " + str(backup.relative_to(server.ROOT)))
    print("Abrí Spotify, reproducí una canción en esta PC e iniciá npm run dev.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
