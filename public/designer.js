(function () {
  "use strict";
  var token = localStorage.getItem("panel_token") || "";
  var model = null;
  var assets = [];
  var pageIndex = 0;
  var selectedId = null;
  var scale = 1;
  var dirty = false;
  var previewActive = false;
  var folderId = "";
  var advancedOpen = false;
  var backupBusy = false;
  window.panelHasUnsavedChanges = function () { return dirty || backupBusy; };

  function $(id) { return document.getElementById(id); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function page() { return model.pages[pageIndex]; }
  function selected() {
    var buttons = page().buttons;
    for (var i = 0; i < buttons.length; i++) if (buttons[i].id === selectedId) return buttons[i];
    return null;
  }
  function message(text) { $("editor-message").textContent = text; }
  function changed() { dirty = true; message("Cambios sin guardar"); }
  function uid() { return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clamp(n, low, high) { return Math.max(low, Math.min(high, n)); }

  function request(method, path, body, done) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, path, true);
    xhr.setRequestHeader("X-Panel-Token", token);
    if (body) xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var result;
      try { result = JSON.parse(xhr.responseText); } catch (e) { result = {}; }
      done(xhr.status >= 200 && xhr.status < 300 ? null : result.error || "Error de conexión", result, xhr.status);
    };
    xhr.onerror = function () { done("Error de conexión", null, 0); };
    xhr.send(body ? JSON.stringify(body) : null);
  }

  function localToken() {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/local-token", true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status !== 200) { message("Abrí este editor en la PC donde corre el servidor: http://localhost:8765/editor"); return; }
      token = JSON.parse(xhr.responseText).token;
      localStorage.setItem("panel_token", token);
      load();
    };
    xhr.send(null);
  }

  function load() {
    request("GET", "/api/config", null, function (err, data, status) {
      if (status === 401) { localToken(); return; }
      if (err) { message(err); return; }
      model = data;
      if (pageIndex >= model.pages.length) pageIndex = 0;
      loadAssets();
      drawAll();
    });
  }
  function loadAssets() {
    request("GET", "/api/assets", null, function (err, data) {
      if (!err) { assets = data.assets; drawPageControls(); drawButtonControls(); }
    });
  }

  function field(label, type, value, onChange, min, max) {
    var box = document.createElement("label");
    box.className = "field";
    box.appendChild(document.createTextNode(label));
    var input = document.createElement("input");
    input.type = type;
    input.value = value == null ? "" : value;
    if (min != null) input.min = min;
    if (max != null) input.max = max;
    if (type === "number") input.step = "1";
    input.oninput = function () { onChange(type === "number" ? parseInt(input.value, 10) || 0 : input.value); changed(); drawPreview(); };
    box.appendChild(input);
    return box;
  }
  function choice(label, values, current, onChange) {
    var box = document.createElement("label");
    box.className = "field";
    box.appendChild(document.createTextNode(label));
    var select = document.createElement("select");
    for (var i = 0; i < values.length; i++) {
      var opt = document.createElement("option");
      opt.value = values[i][0]; opt.textContent = values[i][1];
      select.appendChild(opt);
    }
    select.value = current;
    select.onchange = function () { onChange(select.value); changed(); drawPreview(); };
    box.appendChild(select);
    return box;
  }
  function command(label, callback, extra) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "edit-button small" + (extra ? " " + extra : "");
    button.textContent = label;
    button.onclick = callback;
    return button;
  }
  function upload(file, done) {
    if (!file) return;
    var mime = file.type;
    if (!mime && /\.svg$/i.test(file.name)) mime = "image/svg+xml";
    if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/svg+xml" && mime !== "image/gif") {
      message("Usá PNG, JPG, SVG o GIF."); return;
    }
    if (file.size > 2500000) { message("La imagen debe pesar menos de 2,5 MB."); return; }
    var reader = new FileReader();
    reader.onload = function () {
      message("Cargando imagen...");
      request("POST", "/api/assets", { name: file.name, mime: mime, base64: String(reader.result).split(",")[1] }, function (err, data) {
        if (err) { message(err); return; }
        assets.push(data);
        done(data.url);
        changed();
        drawPageControls(); drawButtonControls(); drawPreview();
      });
    };
    reader.readAsDataURL(file);
  }
  function assetPicker(label, current, onChange) {
    var box = document.createElement("div");
    box.className = "asset-picker";
    box.appendChild(choice(label, [["", "Sin imagen"]].concat(assets.map(function (a) { return [a.url, a.name]; })), current, onChange));
    var fileLabel = document.createElement("label");
    fileLabel.className = "upload-button";
    fileLabel.textContent = "+ Subir PNG, JPG, SVG o GIF";
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".png,.jpg,.jpeg,.svg,.gif,image/png,image/jpeg,image/svg+xml,image/gif";
    input.onchange = function () { upload(input.files[0], onChange); };
    fileLabel.appendChild(input);
    box.appendChild(fileLabel);
    if (current) {
      var img = document.createElement("img");
      img.className = "asset-thumb";
      img.src = current;
      img.alt = "Vista previa";
      box.appendChild(img);
    }
    return box;
  }

  function drawPageControls() {
    if (!model) return;
    var p = page();
    var root = $("page-controls"); clear(root);
    root.appendChild(field("Nombre de la página", "text", p.title, function (v) { p.title = v; drawPageSelect(); }));
    root.appendChild(choice("Distribución", [["grid", "Cuadrícula"], ["free", "Libre"]], p.layout, function (v) { p.layout = v; drawButtonControls(); }));
    root.appendChild(field("Color del fondo", "color", p.backgroundColor, function (v) { p.backgroundColor = v; }));
    root.appendChild(assetPicker("Imagen de fondo", p.backgroundImage, function (v) { p.backgroundImage = v; }));
    var more = advancedSection(root, "Más ajustes de página", false);
    more.appendChild(field("Alto del lienzo libre (px)", "number", p.height, function (v) { p.height = clamp(v, 400, 1400); }, 400, 1400));
    more.appendChild(choice("Animación del fondo", [["none", "Ninguna"], ["pan", "Movimiento lento"], ["zoom", "Zoom lento"]], p.backgroundAnimation, function (v) { p.backgroundAnimation = v; }));
  }
  function advancedSection(root, label, remember) {
    var content = document.createElement("div"); content.className = "advanced-controls";
    var open = remember && advancedOpen;
    content.style.display = open ? "block" : "none";
    var toggle = command(label, function () {
      open = !open; if (remember) advancedOpen = open;
      content.style.display = open ? "block" : "none";
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    toggle.setAttribute("aria-expanded", open ? "true" : "false"); root.appendChild(toggle); root.appendChild(content);
    return content;
  }
  function drawPageSelect() {
    var picker = $("page-select"); clear(picker);
    if (!model) return;
    for (var i = 0; i < model.pages.length; i++) {
      var option = document.createElement("option");
      option.value = i; option.textContent = model.pages[i].title || "Página " + (i + 1);
      picker.appendChild(option);
    }
    picker.value = pageIndex;
  }

  function drawButtonControls() {
    var root = $("button-controls"); clear(root);
    if (!model || !selected()) {
      var note = document.createElement("p"); note.className = "hint";
      note.textContent = "Seleccioná un botón en el lienzo para editarlo.";
      root.appendChild(note); return;
    }
    var b = selected(), basic = root;
    root.appendChild(field("Nombre", "text", b.label, function (v) { b.label = v; }));
    if (b.type !== "spotify") root.appendChild(choice("Mostrar en el botón", [["label", "Solo nombre"], ["icon", "Solo icono"], ["both", "Icono y nombre"]], b.displayMode || "both", function (v) {
      b.displayMode = v;
      if (v === "icon" && !b.icon && !b.builtinIcon && b.type !== "folder") { b.builtinIcon = "grid"; b.iconSize = 72; }
      drawButtonControls();
    }));
    root.appendChild(field("Color de fondo", "color", b.backgroundColor, function (v) { b.backgroundColor = v; }));
    if (b.type !== "spotify") root.appendChild(assetPicker("Foto de fondo", b.image, function (v) { b.image = v; }));
    if (b.type !== "spotify" && b.displayMode !== "label") {
      var palette = document.createElement("div"); palette.className = "icon-palette";
      palette.setAttribute("role", "group"); palette.setAttribute("aria-label", "Elegir icono");
      PanelLayout.icons.forEach(function (entry) {
        var pick = command("", function () { b.builtinIcon = entry[0]; b.icon = ""; changed(); drawButtonControls(); drawPreview(); });
        pick.className = "icon-option" + (!b.icon && b.builtinIcon === entry[0] ? " selected" : "");
        pick.title = entry[1]; pick.setAttribute("aria-label", entry[1]);
        pick.setAttribute("aria-pressed", !b.icon && b.builtinIcon === entry[0] ? "true" : "false");
        pick.appendChild(PanelLayout.symbol(entry[0], 26)); palette.appendChild(pick);
      });
      root.appendChild(palette);
      root.appendChild(assetPicker("O subir un icono propio", b.icon, function (v) { b.icon = v; b.builtinIcon = ""; }));
      if (b.builtinIcon || b.icon) root.appendChild(command("Quitar icono", function () {
        b.icon = ""; b.builtinIcon = "";
        if (b.displayMode === "icon") b.displayMode = "label";
        changed(); drawButtonControls(); drawPreview();
      }));
    }
    if (b.type !== "folder") {
      var destinations = [["", "Fuera de carpetas"]];
      page().buttons.forEach(function (item) { if (item.type === "folder") destinations.push([item.id, item.label]); });
      root.appendChild(choice("Ubicación", destinations, b.folderId || "", function (v) {
        b.folderId = v; folderId = v; drawButtonControls();
      }));
      if (b.type === "button") root.appendChild(choice("Acción", [["hotkey", "Atajo de teclado"], ["url", "Abrir página"]], b.action, function (v) {
        b.action = v; b.value = v === "hotkey" ? "ctrl+shift+m" : "https://www.google.com/"; drawButtonControls();
      }));
      if (b.type === "button") root.appendChild(field(b.action === "hotkey" ? "Atajo (ctrl+shift+m)" : "URL (https://...)", "text", b.value, function (v) { b.value = v; }));
    } else root.appendChild(command("Abrir carpeta", function () { folderId = b.id; selectedId = null; drawButtonControls(); drawPreview(); }));
    if (page().layout === "grid" || b.folderId) {
      var sizes = document.createElement("div");
      (b.type === "spotify" ? [[3, 2], [4, 2], [6, 2]] : [[1, 1], [2, 1], [2, 2]]).forEach(function (size) {
        sizes.appendChild(command(size[0] + " × " + size[1], function () { b.cols = size[0]; b.rows = size[1]; changed(); drawButtonControls(); drawPreview(); }));
      });
      root.appendChild(sizes);
      root.appendChild(field("Columnas", "number", b.cols || 1, function (v) { b.cols = clamp(v, b.type === "spotify" ? 3 : 1, 6); }, b.type === "spotify" ? 3 : 1, 6));
      root.appendChild(field("Filas", "number", b.rows || 1, function (v) { b.rows = clamp(v, b.type === "spotify" ? 2 : 1, 4); }, b.type === "spotify" ? 2 : 1, 4));
    }
    root = advancedSection(root, "Avanzado", true);
    var geometry = document.createElement("div"); geometry.className = "geometry-fields";
    [["X", "x", 0, 1024], ["Y", "y", 0, page().height], ["Ancho", "w", 64, 1024], ["Alto", "h", 50, page().height]].forEach(function (entry) {
      var control = field(entry[0], "number", b[entry[1]], function (v) {
        b[entry[1]] = v;
        b.w = clamp(b.w, b.type === "spotify" ? 320 : 64, 1024); b.h = clamp(b.h, b.type === "spotify" ? 220 : 50, page().height);
        b.x = clamp(b.x, 0, 1024 - b.w); b.y = clamp(b.y, 0, page().height - b.h);
      }, entry[2], entry[3]);
      control.querySelector("input").id = "geo-" + entry[1];
      geometry.appendChild(control);
    });
    if (page().layout === "free" && !b.folderId) root.appendChild(geometry);
    root.appendChild(field("Color del texto", "color", b.textColor, function (v) { b.textColor = v; }));
    root.appendChild(field("Color del borde", "color", b.borderColor, function (v) { b.borderColor = v; }));
    root.appendChild(field("Grosor del borde", "number", b.borderWidth, function (v) { b.borderWidth = clamp(v, 0, 8); }, 0, 8));
    root.appendChild(field("Esquinas redondeadas", "number", b.radius, function (v) { b.radius = clamp(v, 0, 80); }, 0, 80));
    root.appendChild(field("Tamaño del texto", "number", b.fontSize, function (v) { b.fontSize = clamp(v, 12, 48); }, 12, 48));
    root.appendChild(field("Tamaño del icono", "number", b.iconSize, function (v) { b.iconSize = clamp(v, 20, 120); }, 20, 120));
    root.appendChild(field("Opacidad (%)", "number", b.opacity, function (v) { b.opacity = clamp(v, 30, 100); }, 30, 100));
    root.appendChild(choice("Alinear texto", [["left", "Izquierda"], ["center", "Centro"], ["right", "Derecha"]], b.textAlign, function (v) { b.textAlign = v; }));
    root.appendChild(choice("Animación", [["none", "Ninguna"], ["pulse", "Pulso"], ["float", "Flotar"], ["glow", "Brillo"]], b.animation, function (v) { b.animation = v; }));
    if (!b.feedback) b.feedback = { mode: "none", activeLabel: "Activo", activeColor: "#b91c1c", activeIcon: "" };
    if (b.type === "button") root.appendChild(choice("Cambio visual al tocar", [["none", "Sin cambio"], ["toggle", "Alternar estado visual"]], b.feedback.mode, function (v) {
      b.feedback.mode = v; drawButtonControls();
    }));
    if (b.feedback.mode === "toggle") {
      var note = document.createElement("p");
      note.className = "hint";
      note.textContent = "Estado estimado: refleja los toques hechos desde el panel, no los cambios hechos dentro de Discord.";
      root.appendChild(note);
      root.appendChild(field("Texto cuando está activo", "text", b.feedback.activeLabel, function (v) { b.feedback.activeLabel = v; }));
      root.appendChild(field("Color cuando está activo", "color", b.feedback.activeColor, function (v) { b.feedback.activeColor = v; }));
      root.appendChild(assetPicker("Icono cuando está activo", b.feedback.activeIcon, function (v) { b.feedback.activeIcon = v; }));
      var preview = document.createElement("label");
      preview.className = "preview-state-control";
      var check = document.createElement("input"); check.type = "checkbox"; check.checked = previewActive;
      check.onchange = function () { previewActive = check.checked; drawPreview(); };
      preview.appendChild(check);
      preview.appendChild(document.createTextNode(" Mostrar estado activo en la vista previa"));
      root.appendChild(preview);
    }
    root = basic;
    var row = document.createElement("div"); row.className = "edit-controls";
    row.appendChild(command("Duplicar", duplicate));
    var grid = page().layout === "grid" || !!b.folderId;
    row.appendChild(command(grid ? "Antes" : "Al frente", function () { layer(grid ? -1 : 1); }));
    row.appendChild(command(grid ? "Después" : "Atrás", function () { layer(grid ? 1 : -1); }));
    row.appendChild(command("Eliminar", removeButton, "danger"));
    root.appendChild(row);
  }

  function renderButton(b, canvas, box, grid) {
    var el = document.createElement(b.type === "spotify" ? "div" : "button");
    if (b.type !== "spotify") el.type = "button";
    else el.tabIndex = 0;
    var activeState = b.id === selectedId && previewActive && b.feedback && b.feedback.mode === "toggle";
    el.className = "action-canvas designer-button animate-" + b.animation + (b.id === selectedId ? " is-selected" : "") + (activeState ? " feedback-active" : "");
    el.setAttribute("data-id", b.id);
    PanelLayout.position(el, box); PanelLayout.paint(el, b, page(), activeState);
    if (b.type === "spotify") el.querySelector(".spotify-status").textContent = "Vista previa · controles disponibles en el panel";
    if (b.id === selectedId && !grid) {
      ["left", "right"].forEach(function (side) {
        var handle = document.createElement("span"); handle.className = "resize-handle " + side; handle.setAttribute("data-handle", side); el.appendChild(handle);
      });
    }
    el.onmousedown = function (event) { beginDrag(event, b); };
    el.onclick = function () { if (selectedId !== b.id) { selectedId = b.id; previewActive = false; drawButtonControls(); drawPreview(); } };
    if (b.type === "spotify") el.onkeydown = function (event) { if (event.keyCode === 13 || event.keyCode === 32) { event.preventDefault(); el.onclick(); } };
    el.ondblclick = function () { if (b.type === "folder") { folderId = b.id; selectedId = null; drawButtonControls(); drawPreview(); } };
    canvas.appendChild(el);
  }
  function drawPreview() {
    if (!model) return;
    var p = page(), currentFolder = null;
    for (var i = 0; i < p.buttons.length; i++) if (p.buttons[i].id === folderId && p.buttons[i].type === "folder") currentFolder = p.buttons[i];
    if (!currentFolder) folderId = "";
    var shell = $("preview-shell"), canvas = $("preview-canvas"); clear(canvas);
    var layout = PanelLayout.layout(p, folderId);
    PanelLayout.background(canvas, p);
    layout.items.forEach(function (b) { renderButton(b, canvas, layout.boxes[b.id], layout.grid); });
    if (!layout.items.length) {
      var empty = document.createElement("p"); empty.className = "canvas-empty"; empty.textContent = "Agreg\u00e1 un bot\u00f3n para empezar"; canvas.appendChild(empty);
    }
    var trail = $("folder-navigation"); clear(trail);
    if (folderId) {
      trail.appendChild(command("Volver a " + p.title, function () { folderId = ""; selectedId = null; drawButtonControls(); drawPreview(); }));
      var name = document.createElement("strong"); name.textContent = currentFolder.label; trail.appendChild(name);
    }
    $("add-folder").disabled = !!folderId;
    scale = PanelLayout.fit(shell, canvas, layout.height);
  }
  function syncGeometry() {
    var b = selected(); if (!b) return;
    ["x", "y", "w", "h"].forEach(function (key) {
      var input = $("geo-" + key); if (input) input.value = b[key];
    });
  }
  function beginDrag(event, b) {
    if (event.button !== 0) return;
    event.preventDefault();
    if (page().layout === "grid" || folderId) { beginGridDrag(event, b); return; }
    if (selectedId !== b.id) previewActive = false;
    selectedId = b.id;
    var handle = event.target.getAttribute("data-handle") || "move";
    var startX = event.clientX, startY = event.clientY;
    var origin = { x: b.x, y: b.y, w: b.w, h: b.h };
    drawButtonControls(); drawPreview();
    function move(eventMove) {
      var dx = Math.round((eventMove.clientX - startX) / scale);
      var dy = Math.round((eventMove.clientY - startY) / scale);
      if (handle === "move") {
        b.x = clamp(origin.x + dx, 0, 1024 - b.w);
        b.y = clamp(origin.y + dy, 0, page().height - b.h);
      } else if (handle === "right") {
        b.w = clamp(origin.w + dx, b.type === "spotify" ? 320 : 64, 1024 - origin.x);
        b.h = clamp(origin.h + dy, b.type === "spotify" ? 220 : 50, page().height - origin.y);
      } else {
        var newX = clamp(origin.x + dx, 0, origin.x + origin.w - (b.type === "spotify" ? 320 : 64));
        b.x = newX; b.w = origin.w + origin.x - newX;
        b.h = clamp(origin.h + dy, b.type === "spotify" ? 220 : 50, page().height - origin.y);
      }
      syncGeometry(); drawPreview();
    }
    function end() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", end);
      changed();
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", end);
  }

  function beginGridDrag(event, b) {
    selectedId = b.id; previewActive = false;
    var startX = event.clientX, startY = event.clientY, targetId = null;
    drawButtonControls(); drawPreview();
    function move(e) {
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 8) return;
      var rect = $("preview-canvas").getBoundingClientRect(), x = (e.clientX - rect.left) / scale, y = (e.clientY - rect.top) / scale;
      var layout = PanelLayout.layout(page(), folderId); targetId = null;
      layout.items.forEach(function (item) {
        var box = layout.boxes[item.id];
        if (item.id !== b.id && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) targetId = item.id;
      });
      var nodes = $("preview-canvas").querySelectorAll("[data-id]");
      for (var i = 0; i < nodes.length; i++) nodes[i].className = nodes[i].className.replace(" drop-target", "") + (nodes[i].getAttribute("data-id") === targetId ? " drop-target" : "");
    }
    function end() {
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", end);
      if (targetId) {
        var list = page().buttons, from = list.indexOf(b), target = null;
        for (var i = 0; i < list.length; i++) if (list[i].id === targetId) target = list[i];
        var to = list.indexOf(target); list.splice(from, 1); list.splice(to, 0, b); changed();
      }
      drawPreview();
    }
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", end);
  }
  function drawAll() {
    $("panel-title").value = model.title;
    drawPageSelect(); drawPageControls(); drawButtonControls(); drawPreview();
  }
  function addButton(kind) {
    if (!model) return;
    if (page().buttons.length >= 80) { message("Máximo 80 elementos por página."); return; }
    kind = kind === "folder" || kind === "spotify" ? kind : "button";
    var count = page().buttons.length;
    var b = { id: uid(), type: kind, displayMode: kind === "folder" ? "both" : "label", builtinIcon: "", folderId: kind === "folder" ? "" : folderId, cols: 1, rows: 1, label: kind === "folder" ? "Nueva carpeta" : "Nuevo botón", x: 36 + (count * 42) % 700, y: 36 + (count * 42) % 400,
      w: 260, h: 120, backgroundColor: kind === "folder" ? "#48484a" : "#0a84ff", textColor: "#ffffff", borderColor: "#48484a", borderWidth: 0,
      radius: 30, fontSize: 20, iconSize: 52, opacity: 100, textAlign: "center", animation: "none", icon: "", image: "",
      action: kind === "folder" ? "folder" : "url", value: kind === "folder" ? "" : "https://www.google.com/", feedback: { mode: "none", activeLabel: "Activo", activeColor: "#b91c1c", activeIcon: "" } };
    if (kind === "spotify") {
      b.label = "Spotify"; b.action = "spotify"; b.value = ""; b.cols = 4; b.rows = 2; b.w = 646; b.h = 280;
      b.x = 24; b.y = clamp(24 + count * 30, 0, page().height - b.h); b.backgroundColor = "#1c1c1e";
    }
    page().buttons.push(b); selectedId = b.id; changed(); drawButtonControls(); drawPreview();
  }
  function removeButton() {
    var b = selected(); if (!b) return;
    if (b.type === "folder" && PanelLayout.items(page(), b.id).length) {
      var root = $("button-controls"); clear(root);
      var note = document.createElement("p"); note.textContent = "Eliminar carpeta: eleg\u00ed qu\u00e9 hacer con sus botones."; root.appendChild(note);
      root.appendChild(command("Conservar botones en la p\u00e1gina", function () { finishRemove(b, false); }, "primary"));
      root.appendChild(command("Eliminar carpeta y contenido", function () { if (confirm("Eliminar tambi\u00e9n todos sus botones?")) finishRemove(b, true); }, "danger"));
      root.appendChild(command("Cancelar", drawButtonControls)); return;
    }
    finishRemove(b, false);
  }
  function finishRemove(b, contents) {
    page().buttons = page().buttons.filter(function (item) {
      if (item.id === b.id || (contents && item.folderId === b.id)) return false;
      if (item.folderId === b.id) item.folderId = "";
      return true;
    });
    selectedId = null; changed(); drawButtonControls(); drawPreview();
  }
  function duplicate() {
    var b = selected(); if (!b) return;
    var children = b.type === "folder" ? PanelLayout.items(page(), b.id) : [];
    if (page().buttons.length + 1 + children.length > 80) { message("Máximo 80 elementos por página."); return; }
    var copy = JSON.parse(JSON.stringify(b));
    copy.id = uid(); copy.x = clamp(copy.x + 28, 0, 1024 - copy.w); copy.y = clamp(copy.y + 28, 0, page().height - copy.h);
    children.forEach(function (child) { var clone = JSON.parse(JSON.stringify(child)); clone.id = uid(); clone.folderId = copy.id; page().buttons.push(clone); });
    page().buttons.push(copy); selectedId = copy.id; changed(); drawButtonControls(); drawPreview();
  }
  function layer(direction) {
    var list = page().buttons, visible = PanelLayout.items(page(), folderId), b = selected();
    if (!b) return;
    var index = visible.indexOf(b), target = index + direction;
    if (target < 0 || target >= visible.length) return;
    var from = list.indexOf(b), to = list.indexOf(visible[target]);
    list.splice(from, 1); list.splice(to, 0, b); changed(); drawPreview();
  }
  $("panel-title").oninput = function () { if (model) { model.title = this.value; changed(); } };
  $("page-select").onchange = function () { pageIndex = parseInt(this.value, 10); folderId = ""; selectedId = null; drawAll(); };
  $("add-page").onclick = function () {
    if (!model || model.pages.length >= 12) { message("Máximo 12 páginas."); return; }
    model.pages.push({ id: uid(), title: "Nueva página", layout: "grid", height: 620, backgroundColor: "#161618", backgroundImage: "", backgroundAnimation: "none", buttons: [] });
    pageIndex = model.pages.length - 1; folderId = ""; selectedId = null; changed(); drawAll();
  };
  $("delete-page").onclick = function () {
    if (model.pages.length < 2) { message("Debe quedar al menos una página."); return; }
    if (!confirm("¿Eliminar esta página y sus botones?")) return;
    model.pages.splice(pageIndex, 1); pageIndex = Math.max(0, pageIndex - 1); folderId = ""; selectedId = null; changed(); drawAll();
  };
  function movePage(direction) {
    var target = pageIndex + direction;
    if (target < 0 || target >= model.pages.length) return;
    var item = model.pages.splice(pageIndex, 1)[0]; model.pages.splice(target, 0, item);
    pageIndex = target; changed(); drawPageSelect();
  }
  $("page-up").onclick = function () { movePage(-1); };
  $("page-down").onclick = function () { movePage(1); };
  $("add-button").onclick = function () { addButton("button"); };
  $("add-folder").onclick = function () { if (!folderId) addButton("folder"); };
  $("add-spotify").onclick = function () { addButton("spotify"); };
  $("save").onclick = function () {
    if (!model) return;
    request("POST", "/api/config", model, function (err, data) {
      if (err) { message(err); return; }
      model = data; dirty = false; message("Cambios guardados. El iPad se actualiza en unos segundos."); drawAll();
    });
  };
  function transfer(method, path, body, done) {
    var xhr = new XMLHttpRequest(); xhr.open(method, path, true);
    xhr.setRequestHeader("X-Panel-Token", token);
    if (method === "GET") xhr.responseType = "blob";
    else xhr.setRequestHeader("Content-Type", "application/zip");
    xhr.onload = function () {
      if (method === "GET") {
        done(xhr.status === 200 ? null : "No se pudo exportar. Revisá las imágenes del panel.", xhr.response); return;
      }
      var result;
      try { result = JSON.parse(xhr.responseText); } catch (e) { result = {}; }
      done(xhr.status === 200 ? null : result.error || "No se pudo importar el respaldo", result);
    };
    xhr.onerror = function () { done("Error de conexión"); };
    xhr.send(body || null);
  }
  $("export-backup").onclick = function () {
    if (!model || backupBusy) return;
    if (dirty) { message("Guardá los cambios antes de exportar la personalización."); $("save").focus(); return; }
    backupBusy = true; message("Preparando respaldo...");
    transfer("GET", "/api/backup", null, function (err, blob) {
      backupBusy = false; if (err) { message(err); return; }
      var url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = "mi-panel.zip"; document.body.appendChild(link); link.click(); document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      message("Respaldo descargado. Incluye botones, carpetas e imágenes.");
    });
  };
  $("import-backup").onchange = function () {
    var file = this.files[0]; this.value = "";
    if (!file || backupBusy) return;
    if (file.size > 505000000) { message("El respaldo supera el máximo de 505 MB."); return; }
    var root = $("restore-preview"); clear(root); backupBusy = true; message("Validando respaldo...");
    transfer("POST", "/api/restore?preview=1", file, function (err, info) {
      backupBusy = false; if (err) { message(err); return; }
      var summary = document.createElement("p");
      summary.textContent = info.title + " · " + info.pages + " páginas · " + info.folders + " carpetas · " + info.buttons + " botones · " + (info.widgets || 0) + " tarjetas Spotify. Se reemplazará el panel actual y se guardará una copia previa en data/.";
      root.appendChild(summary);
      var restore = command("Reemplazar con este respaldo", function () {
        if (backupBusy) return;
        if (dirty && !confirm("Hay cambios sin guardar. ¿Descartarlos y restaurar el respaldo?")) return;
        backupBusy = true; restore.disabled = true; message("Restaurando...");
        transfer("POST", "/api/restore", file, function (error, result) {
          backupBusy = false; restore.disabled = false;
          if (error) { message(error); return; }
          model = result.config; dirty = false; folderId = ""; selectedId = null; pageIndex = 0;
          clear(root); drawAll(); loadAssets(); message("Personalización restaurada. Copia anterior: data/" + result.backup);
        });
      }, "primary");
      root.appendChild(restore); root.appendChild(command("Cancelar", function () { if (!backupBusy) clear(root); }));
      message("Respaldo válido. Revisá el resumen antes de reemplazar el panel.");
    });
  };
  window.onresize = function () { if (model) drawPreview(); };
  window.onbeforeunload = function () { if (dirty) return "Hay cambios sin guardar."; };
  if (token) load(); else localToken();
}());
