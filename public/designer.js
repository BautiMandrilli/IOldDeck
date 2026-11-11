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
    root.appendChild(field("Alto del lienzo (px)", "number", p.height, function (v) { p.height = clamp(v, 400, 1400); }, 400, 1400));
    root.appendChild(field("Color del fondo", "color", p.backgroundColor, function (v) { p.backgroundColor = v; }));
    root.appendChild(assetPicker("Imagen de fondo", p.backgroundImage, function (v) { p.backgroundImage = v; }));
    root.appendChild(choice("Animación del fondo", [["none", "Ninguna"], ["pan", "Movimiento lento"], ["zoom", "Zoom lento"]], p.backgroundAnimation, function (v) { p.backgroundAnimation = v; }));
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
    var b = selected();
    root.appendChild(field("Texto", "text", b.label, function (v) { b.label = v; }));
    var geometry = document.createElement("div"); geometry.className = "geometry-fields";
    [["X", "x", 0, 1024], ["Y", "y", 0, page().height], ["Ancho", "w", 64, 1024], ["Alto", "h", 50, page().height]].forEach(function (entry) {
      var control = field(entry[0], "number", b[entry[1]], function (v) {
        b[entry[1]] = v;
        b.w = clamp(b.w, 64, 1024); b.h = clamp(b.h, 50, page().height);
        b.x = clamp(b.x, 0, 1024 - b.w); b.y = clamp(b.y, 0, page().height - b.h);
      }, entry[2], entry[3]);
      control.querySelector("input").id = "geo-" + entry[1];
      geometry.appendChild(control);
    });
    root.appendChild(geometry);
    root.appendChild(field("Color del botón", "color", b.backgroundColor, function (v) { b.backgroundColor = v; }));
    root.appendChild(field("Color del texto", "color", b.textColor, function (v) { b.textColor = v; }));
    root.appendChild(field("Color del borde", "color", b.borderColor, function (v) { b.borderColor = v; }));
    root.appendChild(field("Grosor del borde", "number", b.borderWidth, function (v) { b.borderWidth = clamp(v, 0, 8); }, 0, 8));
    root.appendChild(field("Esquinas redondeadas", "number", b.radius, function (v) { b.radius = clamp(v, 0, 80); }, 0, 80));
    root.appendChild(field("Tamaño del texto", "number", b.fontSize, function (v) { b.fontSize = clamp(v, 12, 48); }, 12, 48));
    root.appendChild(field("Tamaño del icono", "number", b.iconSize, function (v) { b.iconSize = clamp(v, 20, 120); }, 20, 120));
    root.appendChild(field("Opacidad (%)", "number", b.opacity, function (v) { b.opacity = clamp(v, 30, 100); }, 30, 100));
    root.appendChild(choice("Alinear texto", [["left", "Izquierda"], ["center", "Centro"], ["right", "Derecha"]], b.textAlign, function (v) { b.textAlign = v; }));
    root.appendChild(assetPicker("Icono (SVG, PNG, JPG o GIF)", b.icon, function (v) { b.icon = v; }));
    root.appendChild(assetPicker("Imagen del botón", b.image, function (v) { b.image = v; }));
    root.appendChild(choice("Animación", [["none", "Ninguna"], ["pulse", "Pulso"], ["float", "Flotar"], ["glow", "Brillo"]], b.animation, function (v) { b.animation = v; }));
    if (!b.feedback) b.feedback = { mode: "none", activeLabel: "Activo", activeColor: "#b91c1c", activeIcon: "" };
    root.appendChild(choice("Cambio visual al tocar", [["none", "Sin cambio"], ["toggle", "Alternar estado visual"]], b.feedback.mode, function (v) {
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
    root.appendChild(choice("Acción", [["hotkey", "Atajo de teclado"], ["url", "Abrir página"]], b.action, function (v) { b.action = v; }));
    root.appendChild(field("Atajo (ctrl+shift+m) o URL (https://...)", "text", b.value, function (v) { b.value = v; }));
    var row = document.createElement("div"); row.className = "edit-controls";
    row.appendChild(command("Duplicar", duplicate));
    row.appendChild(command("Al frente", function () { layer(1); }));
    row.appendChild(command("Atrás", function () { layer(-1); }));
    row.appendChild(command("Eliminar", removeButton, "danger"));
    root.appendChild(row);
  }

  function renderButton(b, canvas) {
    var el = document.createElement("div");
    var activeState = b.id === selectedId && previewActive && b.feedback && b.feedback.mode === "toggle";
    el.className = "action-canvas designer-button animate-" + b.animation + (b.id === selectedId ? " is-selected" : "") + (activeState ? " feedback-active" : "");
    el.style.left = b.x + "px"; el.style.top = b.y + "px";
    el.style.width = b.w + "px"; el.style.height = b.h + "px";
    el.style.backgroundColor = activeState ? b.feedback.activeColor : b.backgroundColor; el.style.color = b.textColor;
    el.style.borderColor = b.borderColor; el.style.borderWidth = b.borderWidth + "px";
    el.style.borderRadius = b.radius + "px"; el.style.fontSize = b.fontSize + "px";
    el.style.opacity = b.opacity / 100;
    if (b.image) el.style.backgroundImage = "linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.2)),url('" + b.image + "')";
    var content = document.createElement("span"); content.className = "button-content"; content.style.textAlign = b.textAlign;
    var visibleIcon = activeState && b.feedback.activeIcon ? b.feedback.activeIcon : b.icon;
    if (visibleIcon) {
      var icon = document.createElement("img"); icon.src = visibleIcon; icon.alt = "";
      icon.style.width = b.iconSize + "px"; icon.style.height = b.iconSize + "px";
      content.appendChild(icon);
    }
    var label = document.createElement("span"); label.textContent = activeState ? b.feedback.activeLabel : b.label;
    content.appendChild(label); el.appendChild(content);
    if (b.id === selectedId) {
      var left = document.createElement("span"); left.className = "resize-handle left"; left.setAttribute("data-handle", "left");
      var right = document.createElement("span"); right.className = "resize-handle right"; right.setAttribute("data-handle", "right");
      el.appendChild(left); el.appendChild(right);
    }
    el.onmousedown = function (event) { beginDrag(event, b); };
    canvas.appendChild(el);
  }
  function drawPreview() {
    if (!model) return;
    var p = page();
    var shell = $("preview-shell"); var canvas = $("preview-canvas"); clear(canvas);
    canvas.style.height = p.height + "px"; canvas.style.backgroundColor = p.backgroundColor;
    var bg = document.createElement("div"); bg.className = "canvas-background bg-" + p.backgroundAnimation;
    if (p.backgroundImage) bg.style.backgroundImage = "url('" + p.backgroundImage + "')";
    canvas.appendChild(bg);
    for (var i = 0; i < p.buttons.length; i++) renderButton(p.buttons[i], canvas);
    scale = shell.clientWidth / 1024;
    canvas.style.transform = "scale(" + scale + ")";
    shell.style.height = Math.ceil(p.height * scale) + "px";
  }
  function syncGeometry() {
    var b = selected(); if (!b) return;
    ["x", "y", "w", "h"].forEach(function (key) {
      var input = $("geo-" + key); if (input) input.value = b[key];
    });
  }
  function beginDrag(event, b) {
    event.preventDefault();
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
        b.w = clamp(origin.w + dx, 64, 1024 - origin.x);
        b.h = clamp(origin.h + dy, 50, page().height - origin.y);
      } else {
        var newX = clamp(origin.x + dx, 0, origin.x + origin.w - 64);
        b.x = newX; b.w = origin.w + origin.x - newX;
        b.h = clamp(origin.h + dy, 50, page().height - origin.y);
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

  function drawAll() {
    $("panel-title").value = model.title;
    drawPageSelect(); drawPageControls(); drawButtonControls(); drawPreview();
  }
  function addButton() {
    var count = page().buttons.length;
    var b = { id: uid(), label: "Nuevo botón", x: 36 + (count * 42) % 700, y: 36 + (count * 42) % 400,
      w: 260, h: 120, backgroundColor: "#1d4ed8", textColor: "#ffffff", borderColor: "#ffffff", borderWidth: 1,
      radius: 18, fontSize: 20, iconSize: 52, opacity: 100, textAlign: "center", animation: "none", icon: "", image: "",
      action: "url", value: "https://www.google.com/", feedback: { mode: "none", activeLabel: "Activo", activeColor: "#b91c1c", activeIcon: "" } };
    page().buttons.push(b); selectedId = b.id; changed(); drawButtonControls(); drawPreview();
  }
  function removeButton() {
    if (!selected()) return;
    var buttons = page().buttons;
    for (var i = 0; i < buttons.length; i++) if (buttons[i].id === selectedId) { buttons.splice(i, 1); break; }
    selectedId = null; changed(); drawButtonControls(); drawPreview();
  }
  function duplicate() {
    var b = selected(); if (!b) return;
    var copy = JSON.parse(JSON.stringify(b));
    copy.id = uid(); copy.x = clamp(copy.x + 28, 0, 1024 - copy.w); copy.y = clamp(copy.y + 28, 0, page().height - copy.h);
    page().buttons.push(copy); selectedId = copy.id; changed(); drawButtonControls(); drawPreview();
  }
  function layer(direction) {
    var list = page().buttons;
    for (var i = 0; i < list.length; i++) if (list[i].id === selectedId) {
      var target = clamp(i + direction, 0, list.length - 1);
      var item = list.splice(i, 1)[0]; list.splice(target, 0, item);
      changed(); drawPreview(); return;
    }
  }
  $("panel-title").oninput = function () { if (model) { model.title = this.value; changed(); } };
  $("page-select").onchange = function () { pageIndex = parseInt(this.value, 10); selectedId = null; drawAll(); };
  $("add-page").onclick = function () {
    if (!model || model.pages.length >= 12) { message("Máximo 12 páginas."); return; }
    model.pages.push({ id: uid(), title: "Nueva página", height: 620, backgroundColor: "#111827", backgroundImage: "", backgroundAnimation: "none", buttons: [] });
    pageIndex = model.pages.length - 1; selectedId = null; changed(); drawAll();
  };
  $("delete-page").onclick = function () {
    if (model.pages.length < 2) { message("Debe quedar al menos una página."); return; }
    if (!confirm("¿Eliminar esta página y sus botones?")) return;
    model.pages.splice(pageIndex, 1); pageIndex = Math.max(0, pageIndex - 1); selectedId = null; changed(); drawAll();
  };
  function movePage(direction) {
    var target = pageIndex + direction;
    if (target < 0 || target >= model.pages.length) return;
    var item = model.pages.splice(pageIndex, 1)[0]; model.pages.splice(target, 0, item);
    pageIndex = target; changed(); drawPageSelect();
  }
  $("page-up").onclick = function () { movePage(-1); };
  $("page-down").onclick = function () { movePage(1); };
  $("add-button").onclick = addButton;
  $("save").onclick = function () {
    if (!model) return;
    request("POST", "/api/config", model, function (err, data) {
      if (err) { message(err); return; }
      model = data; dirty = false; message("Cambios guardados. El iPad se actualiza en unos segundos."); drawAll();
    });
  };
  window.onresize = function () { if (model) drawPreview(); };
  window.onbeforeunload = function () { if (dirty) return "Hay cambios sin guardar."; };
  if (token) load(); else localToken();
}());
