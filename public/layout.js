/* ES5 only: shared by the desktop editor and Safari on iOS 9. */
(function (root) {
  "use strict";
  var WIDTH = 1024, GAP = 16, PAD = 24, CELL = (WIDTH - PAD * 2 - GAP * 5) / 6;
  // A grid page is exactly three rows tall (528px) so it fits the iPad screen without scrolling.
  var GRID_MIN = Math.round(PAD * 2 + CELL * 3 + GAP * 2);
  // Original line symbols, rendered locally without fonts or external libraries.
  var icons = [
    ["grid", "Aplicaciones", "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z"],
    ["mic", "Micrófono", "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8"],
    ["headphones", "Auriculares", "M3 14v-3a9 9 0 0 1 18 0v3 M3 13h4v8H5a2 2 0 0 1-2-2z M21 13h-4v8h2a2 2 0 0 0 2-2z"],
    ["play", "Reproducir", "M7 4l14 8-14 8z"],
    ["pause", "Pausa", "M6 4h4v16H6z M14 4h4v16h-4z"],
    ["music", "Música", "M9 18V5l12-3v13 M9 5v5l12-3 M9 18a3 3 0 1 1-3-3c1 0 2 0 3 1 M21 15a3 3 0 1 1-3-3c1 0 2 0 3 1"],
    ["volume", "Volumen", "M3 9h4l5-5v16l-5-5H3z M16 8a6 6 0 0 1 0 8 M19 4a11 11 0 0 1 0 16"],
    ["home", "Inicio", "M2 11l10-9 10 9 M5 9v12h5v-7h4v7h5V9"],
    ["globe", "Internet", "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M2 12h20 M12 2c-6 6-6 14 0 20 M12 2c6 6 6 14 0 20"],
    ["power", "Encendido", "M12 2v10 M6 5a9 9 0 1 0 12 0"],
    ["star", "Favorito", "M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"],
    ["monitor", "Pantalla", "M3 3h18v13H3z M12 16v5 M7 21h10"],
    ["keyboard", "Teclado", "M2 6h20v13H2z M6 10h1 M11 10h1 M16 10h2 M6 14h1 M10 14h1 M14 14h4 M7 17h10"],
    ["camera", "Cámara", "M3 6h4l2-3h6l2 3h4v15H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0"],
    ["settings", "Ajustes", "M4 3v18 M12 3v18 M20 3v18 M1 8h6 M9 16h6 M17 8h6"],
    ["bell", "Notificaciones", "M5 9a7 7 0 0 1 14 0v7l3 3H2l3-3z M9 22h6"]
  ];
  var NS = "http://www.w3.org/2000/svg", gradientId = 0;
  var GRADIENTS = { instagram: ["#FEDA75", "#FA7E1E", "#D62976", "#962FBF", "#4F5BD5"] };
  function findApp(slug) {
    var apps = root.PanelAppIcons || [];
    for (var i = 0; i < apps.length; i++) if (apps[i].slug === slug) return apps[i];
    return null;
  }
  function svgNode(tag, attrs, parent) {
    var node = document.createElementNS(NS, tag);
    for (var key in attrs) if (attrs.hasOwnProperty(key)) node.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(node);
    return node;
  }
  // iOS-style app icon: rounded square in the brand color with the logo centered.
  function appIcon(slug, size) {
    var app = findApp(slug);
    if (!app) return symbol("grid", size);
    var svg = svgNode("svg", { viewBox: "0 0 60 60", width: size, height: size, "aria-hidden": "true", focusable: "false", "class": "system-icon app-icon" });
    var fill = app.bg, stops = app.bg.indexOf("gradient:") === 0 ? GRADIENTS[app.bg.slice(9)] : null;
    if (stops) {
      var id = "app-gradient-" + (++gradientId), defs = svgNode("defs", {}, svg);
      var gradient = svgNode("linearGradient", { id: id, x1: "0", y1: "1", x2: "1", y2: "0" }, defs);
      stops.forEach(function (stop, i) { svgNode("stop", { offset: i / (stops.length - 1), "stop-color": stop }, gradient); });
      fill = "url(#" + id + ")";
    }
    svgNode("rect", { width: "60", height: "60", rx: "13.5", fill: fill }, svg);
    if (app.bg.toLowerCase() === "#ffffff") svgNode("rect", { x: ".5", y: ".5", width: "59", height: "59", rx: "13", fill: "none", stroke: "rgba(0,0,0,.08)" }, svg);
    svgNode("path", { d: app.path, fill: app.fg, transform: "translate(16 16) scale(1.1667)" }, svg);
    return svg;
  }
  function symbol(name, size) {
    if (name && name.indexOf("app:") === 0) return appIcon(name.slice(4), size);
    var shape = icons[0][2];
    for (var i = 0; i < icons.length; i++) if (icons[i][0] === name) shape = icons[i][2];
    var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", size); svg.setAttribute("height", size);
    svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false"); svg.setAttribute("class", "system-icon");
    var path = document.createElementNS(ns, "path");
    path.setAttribute("d", shape); path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.7"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path); return svg;
  }
  function items(page, folderId) {
    return page.buttons.filter(function (b) { return (b.folderId || "") === (folderId || ""); });
  }
  function layout(page, folderId) {
    var list = items(page, folderId), grid = !!folderId || page.layout === "grid";
    var occupied = [], boxes = {}, height = grid ? 0 : page.height;
    list.forEach(function (b) {
      var box = { x: b.x, y: b.y, w: b.w, h: b.h };
      if (grid) {
        var cols = Math.max(1, Math.min(6, b.cols || 1)), rows = Math.max(1, Math.min(4, b.rows || 1));
        var row = 0, col, found = false, r, c;
        while (!found) {
          for (col = 0; col <= 6 - cols; col++) {
            found = true;
            for (r = row; r < row + rows; r++) for (c = col; c < col + cols; c++) {
              if (occupied[r] && occupied[r][c]) found = false;
            }
            if (found) break;
          }
          if (!found) row++;
        }
        for (r = row; r < row + rows; r++) {
          if (!occupied[r]) occupied[r] = [];
          for (c = col; c < col + cols; c++) occupied[r][c] = true;
        }
        box = { x: PAD + col * (CELL + GAP), y: PAD + row * (CELL + GAP),
          w: cols * CELL + (cols - 1) * GAP, h: rows * CELL + (rows - 1) * GAP };
      }
      boxes[b.id] = box;
      height = Math.max(height, box.y + box.h + PAD);
    });
    return { items: list, boxes: boxes, height: Math.max(grid ? (folderId ? 215 : GRID_MIN) : page.height, height), grid: grid };
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function paint(el, b, page, active) {
    clear(el);
    var feedback = b.feedback || {}, color = active ? feedback.activeColor : b.backgroundColor;
    el.style.backgroundColor = color;
    el.style.color = b.textColor; el.style.borderColor = b.borderColor;
    el.style.borderWidth = b.borderWidth + "px"; el.style.borderRadius = b.radius + "px";
    el.style.fontSize = b.fontSize + "px"; el.style.opacity = b.opacity / 100;
    el.style.backgroundImage = b.image ? "linear-gradient(rgba(0,0,0,.18),rgba(0,0,0,.18)),url('" + b.image + "')" : "none";
    if (b.type === "spotify") {
      paintSpotify(el, b);
      return;
    }
    var content = document.createElement("span"); content.className = "button-content";
    var mode = b.displayMode || "both", name = active ? feedback.activeLabel : b.label;
    el.setAttribute("aria-label", name);
    el.title = name + (feedback.mode === "toggle" ? " · Estado estimado según los toques del panel" : "");
    if (mode === "icon") content.className += " icon-only";
    content.style.textAlign = b.textAlign;
    var visibleIcon = active && feedback.activeIcon ? feedback.activeIcon : b.icon;
    if (b.type === "folder") {
      paintFolder(el, b, page, content, mode, visibleIcon, color);
    } else if (mode !== "label" && visibleIcon) {
      var img = document.createElement("img"); img.src = visibleIcon; img.alt = "";
      img.style.width = b.iconSize + "px"; img.style.height = b.iconSize + "px";
      content.appendChild(img);
    } else if (mode !== "label" && (b.builtinIcon || mode === "icon")) {
      content.appendChild(symbol(b.builtinIcon || "grid", b.iconSize || 72));
    }
    if (mode !== "icon") {
      var label = document.createElement("span"); label.className = "button-label";
      label.textContent = name; content.appendChild(label);
    }
    el.appendChild(content);
    if (feedback.mode === "toggle") {
      var badge = document.createElement("span"); badge.className = "feedback-badge";
      badge.textContent = "ESTIMADO"; el.appendChild(badge);
    }
  }
  // Folder tile: a real folder (back panel with a tab + front pocket) in the
  // folder's colour, showing miniatures of what is inside and a count badge.
  function paintFolder(el, b, page, content, mode, visibleIcon, color) {
    el.className = el.className.replace(/\s*(is-folder|folder-no-preview|folder-no-label)/g, "") + " is-folder" +
      (mode === "label" ? " folder-no-preview" : "") + (mode === "icon" ? " folder-no-label" : "");
    el.style.backgroundColor = "transparent"; el.style.backgroundImage = "none";
    var children = items(page, b.id);
    var shape = document.createElement("span"); shape.className = "folder-shape";
    var back = document.createElement("span"); back.className = "folder-back"; back.style.backgroundColor = color;
    var front = document.createElement("span"); front.className = "folder-front"; front.style.backgroundColor = color;
    if (b.image) front.style.backgroundImage = "linear-gradient(rgba(255,255,255,.18),rgba(0,0,0,.12)),url('" + b.image + "')";
    shape.appendChild(back); shape.appendChild(front);
    if (mode !== "label") {
      var mini = document.createElement("span"); mini.className = "folder-miniatures";
      if (visibleIcon) {
        var img = document.createElement("img"); img.src = visibleIcon; img.alt = ""; img.className = "folder-own-icon"; mini.appendChild(img);
      } else if (b.builtinIcon) {
        var own = symbol(b.builtinIcon, 34); own.setAttribute("class", own.getAttribute("class") + " folder-own-icon"); mini.appendChild(own);
      } else {
        children.slice(0, 6).forEach(function (child) {
          var tile = document.createElement("span"); tile.className = "folder-mini";
          var isApp = child.builtinIcon && child.builtinIcon.indexOf("app:") === 0;
          if (isApp) tile.appendChild(symbol(child.builtinIcon, 24));
          else {
            tile.style.backgroundColor = child.type === "spotify" ? "#1ed760" : child.backgroundColor;
            if (child.icon || child.image) tile.style.backgroundImage = "url('" + (child.icon || child.image) + "')";
            else if (child.builtinIcon) tile.appendChild(symbol(child.builtinIcon, 16));
            else tile.textContent = (child.label || "?").slice(0, 1);
          }
          mini.appendChild(tile);
        });
        if (!children.length) { mini.className += " folder-empty"; mini.textContent = "Vacía"; }
      }
      front.appendChild(mini);
    }
    var count = document.createElement("span"); count.className = "folder-count";
    count.textContent = children.length; shape.appendChild(count);
    content.appendChild(shape);
  }
  function paintSpotify(el, b) {
    el.className += " spotify-card";
    el.setAttribute("role", "group"); el.setAttribute("aria-label", b.label || "Spotify");
    function part(tag, name, text, parent) {
      var node = document.createElement(tag); node.className = name;
      if (text) node.textContent = text;
      (parent || el).appendChild(node); return node;
    }
    var row = part("div", "spotify-main");
    var cover = part("div", "spotify-cover", "", row); cover.appendChild(symbol("music", 46));
    var img = part("img", "spotify-art", "", cover); img.alt = ""; img.style.display = "none";
    var info = part("div", "spotify-info", "", row);
    part("div", "spotify-title", "Spotify en tu PC", info);
    part("div", "spotify-artist", "", info);
    part("div", "spotify-status", "Conectando con Spotify…", info);
    var timeline = part("div", "spotify-timeline");
    var track = part("div", "spotify-progress", "", timeline); track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", "Progreso de la canción"); track.setAttribute("aria-valuemin", "0"); track.setAttribute("aria-valuemax", "100");
    part("div", "spotify-progress-fill", "", track);
    var times = part("div", "spotify-times", "", timeline);
    part("span", "spotify-elapsed", "0:00", times); part("span", "spotify-duration", "0:00", times);
    var controls = part("div", "spotify-controls");
    [["previous", "Anterior"], ["playpause", "Reproducir / pausar"], ["next", "Siguiente"]].forEach(function (entry) {
      var button = part("button", "spotify-control spotify-" + entry[0], "", controls);
      button.type = "button"; button.disabled = true; button.setAttribute("data-command", entry[0]);
      button.setAttribute("aria-label", entry[1]); button.title = entry[1];
      if (entry[0] === "playpause") button.appendChild(symbol("play", 25));
      else {
        var svg = symbol("play", 22);
        if (entry[0] === "previous") svg.style.webkitTransform = svg.style.transform = "rotate(180deg)";
        button.appendChild(svg);
        var bar = document.createElement("span"); bar.className = "skip-bar"; button.appendChild(bar);
      }
    });
  }
  function background(canvas, page) {
    canvas.style.backgroundColor = page.backgroundColor;
    var bg = document.createElement("div"); bg.className = "canvas-background bg-" + page.backgroundAnimation;
    if (page.backgroundImage) bg.style.backgroundImage = "url('" + page.backgroundImage + "')";
    canvas.appendChild(bg);
  }
  function position(el, box) {
    el.style.left = box.x + "px"; el.style.top = box.y + "px";
    el.style.width = box.w + "px"; el.style.height = box.h + "px";
  }
  function fit(shell, canvas, height) {
    var scale = shell.clientWidth / WIDTH;
    canvas.style.height = height + "px";
    canvas.style.webkitTransform = "scale(" + scale + ")";
    canvas.style.transform = "scale(" + scale + ")";
    shell.style.height = Math.ceil(height * scale) + "px";
    return scale;
  }
  // Size in design pixels of a span of n grid boxes.
  function span(n) { return n * CELL + (n - 1) * GAP; }
  root.PanelLayout = { findApp: findApp, grid: { width: WIDTH, pad: PAD, gap: GAP, cell: CELL, cols: 6, rows: 4 }, span: span, items: items, layout: layout, paint: paint, background: background, position: position, fit: fit, icons: icons, symbol: symbol };
}(this));
