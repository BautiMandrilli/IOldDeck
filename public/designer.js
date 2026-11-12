(function () {
  "use strict";
  var token = localStorage.getItem("panel_token") || "";
  var model = null;
  var assets = [];
  var desktopApps = [];
  var pageIndex = 0;
  var selectedId = null;
  var scale = 1;
  var dirty = false;
  var previewActive = false;
  var folderId = "";
  var backupBusy = false;
  var messageTimer;
  // Undo history: serialized models, newest last. Typing in one field coalesces.
  var history = [], future = [], savedJSON = "", lastKey = null, lastChange = 0;
  window.panelHasUnsavedChanges = function () { return dirty || backupBusy; };

  function $(id) { return document.getElementById(id); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function page() { return model.pages[pageIndex]; }
  function selected() {
    if (!model) return null;
    var buttons = page().buttons;
    for (var i = 0; i < buttons.length; i++) if (buttons[i].id === selectedId) return buttons[i];
    return null;
  }
  function nodeFor(id) { return $("preview-canvas").querySelector('[data-id="' + id + '"]'); }
  function isGrid() { return page().layout === "grid" || !!folderId; }
  function message(text, kind) {
    var bar = $("editor-message");
    bar.textContent = text;
    bar.className = "statusbar visible " + (kind || "info");
    clearTimeout(messageTimer);
    if (kind !== "error") messageTimer = setTimeout(function () { bar.className = "statusbar " + (kind || "info"); }, 6000);
  }
  function uid() { return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clamp(n, low, high) { return Math.max(low, Math.min(high, n)); }

  // ---------- Dirty state and undo ----------
  function setDirty(value) {
    dirty = value;
    var state = $("save-state");
    state.className = "save-state" + (dirty ? " is-dirty" : "");
    state.querySelector(".save-text").textContent = dirty ? "Cambios sin guardar" : "Todo guardado";
    $("save").disabled = !dirty;
    $("undo").disabled = history.length < 2;
    $("redo").disabled = !future.length;
  }
  function resetHistory() {
    savedJSON = JSON.stringify(model);
    history = [savedJSON]; future = []; lastKey = null;
    setDirty(false);
  }
  function changed(key) {
    var json = JSON.stringify(model), now = Date.now();
    if (json === history[history.length - 1]) return;
    if (key && key === lastKey && now - lastChange < 1200 && history.length > 1) history[history.length - 1] = json;
    else history.push(json);
    if (history.length > 120) history.shift();
    future = []; lastKey = key || null; lastChange = now;
    setDirty(json !== savedJSON);
  }
  function restore(json) {
    var before = Motion.measure($("preview-canvas"));
    model = JSON.parse(json);
    if (pageIndex >= model.pages.length) pageIndex = model.pages.length - 1;
    if (!selected()) selectedId = null;
    lastKey = null;
    drawAll(before);
    setDirty(json !== savedJSON);
  }
  function undo() {
    if (history.length < 2) return;
    future.push(history.pop());
    restore(history[history.length - 1]);
    message("Deshecho", "info");
  }
  function redo() {
    if (!future.length) return;
    history.push(future.pop());
    restore(history[history.length - 1]);
    message("Rehecho", "info");
  }

  // ---------- Network ----------
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
      if (xhr.status !== 200) { message("Abrí este editor en la PC donde corre el servidor: http://localhost:8765/editor", "error"); return; }
      token = JSON.parse(xhr.responseText).token;
      localStorage.setItem("panel_token", token);
      load();
    };
    xhr.send(null);
  }
  function load() {
    request("GET", "/api/config", null, function (err, data, status) {
      if (status === 401) { localToken(); return; }
      if (err) { message(err, "error"); return; }
      model = data;
      if (pageIndex >= model.pages.length) pageIndex = 0;
      resetHistory();
      loadAssets();
      loadDesktopApps();
      drawAll();
    });
  }
  // Desktop apps the server can open directly, with whether each is installed on this PC.
  function loadDesktopApps() {
    request("GET", "/api/desktop-apps", null, function (err, data) {
      if (!err) { desktopApps = data.apps; drawButtonControls(); }
    });
  }
  function desktopApp(slug) {
    for (var i = 0; i < desktopApps.length; i++) if (desktopApps[i].slug === slug) return desktopApps[i];
    return null;
  }
  function defaultDesktopApp(b) {
    var fromIcon = b.builtinIcon && b.builtinIcon.indexOf("app:") === 0 ? desktopApp(b.builtinIcon.slice(4)) : null;
    if (fromIcon) return fromIcon.slug;
    for (var i = 0; i < desktopApps.length; i++) if (desktopApps[i].installed) return desktopApps[i].slug;
    return "discord";
  }
  function loadAssets() {
    request("GET", "/api/assets", null, function (err, data) {
      if (!err) { assets = data.assets; drawPageControls(); drawButtonControls(); }
    });
  }

  // ---------- Controls ----------
  function field(label, type, value, onChange, min, max) {
    var box = el("label", "field" + (type === "color" || type === "number" ? " inline" : ""));
    box.appendChild(el("span", "field-label", label));
    var input = document.createElement("input");
    input.type = type;
    input.value = value == null ? "" : value;
    if (min != null) input.min = min;
    if (max != null) input.max = max;
    if (type === "number") input.step = "1";
    input.oninput = function () { onChange(type === "number" ? parseInt(input.value, 10) || 0 : input.value); changed(input); drawPreview(); };
    box.appendChild(input);
    return box;
  }
  function choice(label, values, current, onChange) {
    var box = el("label", "field");
    box.appendChild(el("span", "field-label", label));
    var select = document.createElement("select");
    for (var i = 0; i < values.length; i++) {
      var opt = document.createElement("option");
      opt.value = values[i][0]; opt.textContent = values[i][1];
      select.appendChild(opt);
    }
    select.value = current;
    select.onchange = function () { onChange(select.value); changed(); drawPreview(true); };
    box.appendChild(select);
    return box;
  }
  // Segmented control: every option visible, one click to switch.
  function segmented(label, values, current, onChange) {
    var box = el("div", "field");
    box.appendChild(el("span", "field-label", label));
    var group = el("div", "segmented");
    group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", label);
    values.forEach(function (entry) {
      var on = entry[0] === current, option = el("button", "segment" + (on ? " selected" : ""), entry[1]);
      option.type = "button";
      option.setAttribute("role", "radio"); option.setAttribute("aria-checked", on ? "true" : "false");
      option.setAttribute("data-value", entry[0]);
      option.onclick = function () {
        if (entry[0] === current) return;
        onChange(entry[0]); changed(); drawPreview(true);
      };
      group.appendChild(option);
    });
    box.appendChild(group);
    return box;
  }
  function command(label, callback, extra) {
    var button = el("button", "edit-button small" + (extra ? " " + extra : ""), label);
    button.type = "button";
    button.onclick = callback;
    return button;
  }
  // Inspector sections fold open/closed; the choice is remembered in this browser.
  var SECTIONS_KEY = "panel_editor_sections", sections = {}, collapseAll = null;
  try { sections = JSON.parse(localStorage.getItem(SECTIONS_KEY)) || {}; } catch (e) { sections = {}; }
  function isOpen(key) { return sections.hasOwnProperty(key) ? sections[key] : key !== "avanzado"; }
  function rememberSections() { try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections)); } catch (e) { /* private mode */ } }
  function setSection(toggle, open) {
    toggle.parentNode.classList.toggle("is-collapsed", !open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function sectionToggles() { return $("button-controls").querySelectorAll(".group-toggle"); }
  function updateCollapseAll() {
    if (!collapseAll) return;
    var toggles = sectionToggles(), anyOpen = false;
    for (var i = 0; i < toggles.length; i++) if (isOpen(toggles[i].getAttribute("data-section"))) anyOpen = true;
    collapseAll.textContent = anyOpen ? "Contraer todo" : "Expandir todo";
    collapseAll.setAttribute("data-open", anyOpen ? "true" : "false");
  }
  function group(root, title, key) {
    var section = el("section", "group"), card = el("div", "group-card");
    if (title && key) {
      var toggle = el("button", "group-toggle");
      toggle.type = "button";
      toggle.setAttribute("data-section", key);
      toggle.appendChild(el("span", "", title));
      toggle.onclick = function () {
        sections[key] = !isOpen(key); rememberSections();
        setSection(toggle, sections[key]); updateCollapseAll();
      };
      section.appendChild(toggle);
      if (!isOpen(key)) section.classList.add("is-collapsed");
      toggle.setAttribute("aria-expanded", isOpen(key) ? "true" : "false");
    } else if (title) section.appendChild(el("h3", "group-title", title));
    section.appendChild(card); root.appendChild(section);
    return card;
  }
  function upload(file, done) {
    if (!file) return;
    var mime = file.type;
    if (!mime && /\.svg$/i.test(file.name)) mime = "image/svg+xml";
    if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/svg+xml" && mime !== "image/gif") {
      message("Usá PNG, JPG, SVG o GIF.", "error"); return;
    }
    if (file.size > 2500000) { message("La imagen debe pesar menos de 2,5 MB.", "error"); return; }
    var reader = new FileReader();
    reader.onload = function () {
      message("Cargando imagen…");
      request("POST", "/api/assets", { name: file.name, mime: mime, base64: String(reader.result).split(",")[1] }, function (err, data) {
        if (err) { message(err, "error"); return; }
        assets.push(data);
        done(data.url);
        changed();
        message("Imagen agregada", "success");
        drawPageControls(); drawButtonControls(); drawPreview();
      });
    };
    reader.readAsDataURL(file);
  }
  function assetPicker(label, current, onChange) {
    var box = el("div", "asset-picker");
    box.appendChild(choice(label, [["", "Sin imagen"]].concat(assets.map(function (a) { return [a.url, a.name]; })), current, onChange));
    var row = el("div", "asset-row");
    if (current) {
      var img = el("img", "asset-thumb");
      img.src = current; img.alt = "Vista previa";
      row.appendChild(img);
    }
    var fileLabel = el("label", "upload-button", "Subir imagen…");
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".png,.jpg,.jpeg,.svg,.gif,image/png,image/jpeg,image/svg+xml,image/gif";
    input.onchange = function () { upload(input.files[0], onChange); };
    fileLabel.appendChild(input);
    row.appendChild(fileLabel);
    box.appendChild(row);
    return box;
  }
  function advancedSection(root, label) {
    var content = el("div", "advanced-controls");
    var open = false;
    content.style.display = open ? "block" : "none";
    var toggle = command(label, function () {
      open = !open;
      content.style.display = open ? "block" : "none";
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }, "disclosure");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    root.appendChild(toggle); root.appendChild(content);
    return content;
  }

  // ---------- Sidebar: pages ----------
  function drawPageControls() {
    if (!model) return;
    var p = page();
    var root = $("page-controls"); clear(root);
    root.appendChild(field("Nombre de la página", "text", p.title, function (v) { p.title = v; drawPageList(); }));
    root.appendChild(segmented("Distribución", [["grid", "Cuadrícula"], ["free", "Libre"]], p.layout, function (v) { p.layout = v; drawPageControls(); drawButtonControls(); }));
    root.appendChild(field("Color del fondo", "color", p.backgroundColor, function (v) { p.backgroundColor = v; }));
    root.appendChild(assetPicker("Imagen de fondo", p.backgroundImage, function (v) { p.backgroundImage = v; }));
    var more = advancedSection(root, "Más ajustes de página");
    more.appendChild(field("Alto del lienzo libre (px)", "number", p.height, function (v) { p.height = clamp(v, 400, 1400); }, 400, 1400));
    more.appendChild(choice("Animación del fondo", [["none", "Ninguna"], ["pan", "Movimiento lento"], ["zoom", "Zoom lento"]], p.backgroundAnimation, function (v) { p.backgroundAnimation = v; }));
  }
  function drawPageList() {
    var list = $("page-list"); clear(list);
    if (!model) return;
    model.pages.forEach(function (p, i) {
      var row = el("button", "page-row" + (i === pageIndex ? " selected" : ""));
      row.type = "button";
      row.setAttribute("role", "option"); row.setAttribute("aria-selected", i === pageIndex ? "true" : "false");
      row.appendChild(el("span", "page-index", String(i + 1)));
      row.appendChild(el("span", "page-name", p.title || "Página " + (i + 1)));
      row.appendChild(el("span", "page-count", String(p.buttons.length)));
      row.title = p.buttons.length + " elementos";
      row.onclick = function () {
        if (i === pageIndex) return;
        pageIndex = i; folderId = ""; selectedId = null; drawAll();
      };
      list.appendChild(row);
    });
    $("page-up").disabled = pageIndex === 0;
    $("page-down").disabled = pageIndex === model.pages.length - 1;
    $("delete-page").disabled = model.pages.length < 2;
  }

  // ---------- App icon library ----------
  var appQuery = "";
  var DEFAULT_LABELS = ["", "Nuevo botón", "Botón", "Nueva carpeta"];
  function plain(text) { return String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function shortUrl(url) { return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""); }
  function applyApp(b, app, link) {
    var previous = b.builtinIcon && b.builtinIcon.indexOf("app:") === 0 ? PanelLayout.findApp(b.builtinIcon.slice(4)) : null;
    b.builtinIcon = "app:" + app.slug; b.icon = "";
    if (b.displayMode === "label") b.displayMode = "both";
    if (b.iconSize < 56) b.iconSize = 64;
    if (DEFAULT_LABELS.indexOf(b.label) >= 0 || (previous && b.label === previous.name)) b.label = app.name;
    if (b.backgroundColor === "#0a84ff") b.backgroundColor = "#1c1c1e";
    // Prefer the installed desktop app; otherwise the button opens the website.
    var desktop = desktopApp(app.slug), opens = "";
    if (link && b.type === "button") {
      if (desktop && desktop.installed) { b.action = "app"; b.value = app.slug; opens = "la app de la PC"; }
      else if (app.url) { b.action = "url"; b.value = app.url; opens = shortUrl(app.url); }
    }
    changed(); drawButtonControls(); drawPreview();
    message(app.name + " aplicado" + (opens ? " · abre " + opens : ""), "success");
  }
  // Searchable grid of real app logos, grouped by category like a Home Screen.
  function appLibrary(b) {
    var box = el("div", "app-library"), grid = el("div", "app-grid"), check = null;
    var search = document.createElement("input");
    search.type = "search"; search.className = "app-search"; search.value = appQuery;
    search.placeholder = "Buscar app (YouTube, Gmail…)"; search.setAttribute("aria-label", "Buscar app");
    grid.setAttribute("role", "group"); grid.setAttribute("aria-label", "Apps");
    function render() {
      clear(grid);
      var query = plain(search.value.trim()), lastCategory = "", shown = 0;
      (window.PanelAppIcons || []).forEach(function (app) {
        if (query && plain(app.name + " " + app.category).indexOf(query) < 0) return;
        if (!query && app.category !== lastCategory) { grid.appendChild(el("div", "app-category", app.category)); lastCategory = app.category; }
        var on = b.builtinIcon === "app:" + app.slug, option = el("button", "app-option" + (on ? " selected" : ""));
        option.type = "button";
        option.setAttribute("data-app", app.slug); option.setAttribute("aria-pressed", on ? "true" : "false");
        option.title = app.name + (app.url ? " · " + shortUrl(app.url) : "");
        option.appendChild(PanelLayout.symbol("app:" + app.slug, 44));
        option.appendChild(el("span", "app-name", app.name));
        option.onclick = function () { applyApp(b, app, check ? check.checked : false); };
        grid.appendChild(option); shown++;
      });
      if (!shown) grid.appendChild(el("p", "hint app-empty", "No hay apps con ese nombre. Podés subir tu propia imagen abajo."));
    }
    search.oninput = function () { appQuery = search.value; render(); };
    box.appendChild(search);
    box.appendChild(grid);
    if (b.type === "button") {
      var row = el("label", "check-row");
      check = document.createElement("input"); check.type = "checkbox"; check.checked = b.action !== "hotkey";
      row.appendChild(check);
      row.appendChild(el("span", "", "Al elegir una app, el botón la abre (la app instalada en la PC o, si no está, su página web)"));
      box.appendChild(row);
    }
    render();
    return box;
  }

  // ---------- Inspector ----------
  function kindName(b) { return b.type === "folder" ? "Carpeta" : b.type === "spotify" ? "Tarjeta Spotify" : "Botón"; }
  function drawEmptyInspector(root) {
    var empty = el("div", "inspector-empty");
    var glyph = el("div", "empty-glyph"); glyph.appendChild(PanelLayout.symbol("grid", 30));
    empty.appendChild(glyph);
    empty.appendChild(el("h2", "", "Nada seleccionado"));
    empty.appendChild(el("p", "hint", "Hacé clic en un elemento de la vista previa para editarlo, o agregá uno nuevo desde la barra superior."));
    var keys = el("dl", "shortcut-list");
    [["Ctrl Z", "Deshacer"], ["Ctrl S", "Guardar"], ["Ctrl D", "Duplicar"], ["Supr", "Eliminar"], ["Flechas", "Mover en modo libre"], ["Esc", "Salir de la selección"]].forEach(function (k) {
      keys.appendChild(el("dt", "", k[0])); keys.appendChild(el("dd", "", k[1]));
    });
    empty.appendChild(keys);
    root.appendChild(empty);
  }
  function drawButtonControls() {
    var root = $("button-controls"); clear(root);
    collapseAll = null;
    if (!model || !selected()) { drawEmptyInspector(root); return; }
    var b = selected(), isApp = b.builtinIcon && b.builtinIcon.indexOf("app:") === 0;
    var head = el("div", "inspector-header");
    var glyph = el("span", "inspector-glyph" + (isApp ? " is-app" : ""));
    if (!isApp) glyph.style.backgroundColor = b.backgroundColor;
    glyph.appendChild(PanelLayout.symbol(b.type === "spotify" ? "music" : b.builtinIcon || "grid", isApp ? 38 : 18));
    head.appendChild(glyph);
    var names = el("div", "inspector-names");
    names.appendChild(el("strong", "", b.label || kindName(b)));
    names.appendChild(el("span", "", kindName(b)));
    head.appendChild(names);
    collapseAll = el("button", "collapse-all");
    collapseAll.type = "button";
    collapseAll.title = "Abrir o cerrar todas las secciones";
    collapseAll.onclick = function () {
      var open = collapseAll.getAttribute("data-open") !== "true", toggles = sectionToggles();
      for (var i = 0; i < toggles.length; i++) { sections[toggles[i].getAttribute("data-section")] = open; setSection(toggles[i], open); }
      rememberSections(); updateCollapseAll();
    };
    head.appendChild(collapseAll);
    root.appendChild(head);

    var content = group(root, "Contenido", "contenido");
    content.appendChild(field("Nombre", "text", b.label, function (v) { b.label = v; head.querySelector("strong").textContent = v || kindName(b); }));
    if (b.type !== "spotify") content.appendChild(segmented("Mostrar en el botón", [["label", "Nombre"], ["icon", "Icono"], ["both", "Ambos"]], b.displayMode || "both", function (v) {
      b.displayMode = v;
      if (v === "icon" && !b.icon && !b.builtinIcon && b.type !== "folder") { b.builtinIcon = "grid"; b.iconSize = 72; }
      drawButtonControls();
    }));

    if (b.type !== "spotify") {
      var icon = group(root, "Icono", "icono");
      icon.appendChild(el("span", "field-label", "Apps"));
      icon.appendChild(appLibrary(b));
      icon.appendChild(el("span", "field-label sub-label", "Símbolos"));
      var palette = el("div", "icon-palette");
      palette.setAttribute("role", "group"); palette.setAttribute("aria-label", "Elegir icono");
      PanelLayout.icons.forEach(function (entry) {
        var on = !b.icon && b.builtinIcon === entry[0];
        var pick = command("", function () {
          b.builtinIcon = entry[0]; b.icon = "";
          if (b.displayMode === "label") b.displayMode = "both";
          changed(); drawButtonControls(); drawPreview();
        });
        pick.className = "icon-option" + (on ? " selected" : "");
        pick.title = entry[1]; pick.setAttribute("aria-label", entry[1]);
        pick.setAttribute("aria-pressed", on ? "true" : "false");
        pick.appendChild(PanelLayout.symbol(entry[0], 22)); palette.appendChild(pick);
      });
      icon.appendChild(palette);
      icon.appendChild(assetPicker("Imagen propia", b.icon, function (v) {
        b.icon = v; b.builtinIcon = "";
        if (v && b.displayMode === "label") b.displayMode = "both";
      }));
      if (b.builtinIcon || b.icon) icon.appendChild(command("Quitar icono", function () {
        b.icon = ""; b.builtinIcon = "";
        if (b.displayMode === "icon") b.displayMode = "label";
        changed(); drawButtonControls(); drawPreview();
      }, "plain"));
    }

    var look = group(root, "Apariencia", "apariencia");
    look.appendChild(field("Color de fondo", "color", b.backgroundColor, function (v) { b.backgroundColor = v; if (!isApp) glyph.style.backgroundColor = v; }));
    if (b.type !== "spotify") look.appendChild(assetPicker("Foto de fondo", b.image, function (v) { b.image = v; }));

    if (b.type === "button") {
      var action = group(root, "Acción", "accion");
      action.appendChild(segmented("Al tocar", [["hotkey", "Atajo"], ["url", "Página web"], ["app", "App de la PC"]], b.action, function (v) {
        b.action = v;
        b.value = v === "hotkey" ? "ctrl+shift+m" : v === "url" ? "https://www.google.com/" : defaultDesktopApp(b);
        drawButtonControls();
      }));
      if (b.action === "app") {
        action.appendChild(choice("App", desktopApps.map(function (app) {
          return [app.slug, app.name + (app.installed ? " · instalada" : " · no encontrada")];
        }), b.value, function (v) { b.value = v; drawButtonControls(); }));
        var chosen = desktopApp(b.value);
        action.appendChild(el("p", "hint", chosen && !chosen.installed
          ? chosen.name + " no está instalada en esta PC: el botón abrirá " + shortUrl(chosen.web) + " en el navegador hasta que la instales."
          : "Abre la app instalada en esta PC, no el navegador. Si la desinstalás, abre su página web."));
      } else action.appendChild(field(b.action === "hotkey" ? "Atajo (ej. ctrl+shift+m)" : "Dirección (https://…)", "text", b.value, function (v) { b.value = v; }));
    }
    var place = group(root, b.type === "folder" ? "Carpeta" : "Ubicación", "ubicacion");
    if (b.type !== "folder") {
      var destinations = [["", "Fuera de carpetas"]];
      page().buttons.forEach(function (item) { if (item.type === "folder") destinations.push([item.id, item.label]); });
      place.appendChild(choice("Ubicación", destinations, b.folderId || "", function (v) {
        b.folderId = v; folderId = v; drawButtonControls();
      }));
    } else place.appendChild(command("Abrir carpeta", function () { enterFolder(b.id); }, "full"));

    var more = group(root, "Avanzado", "avanzado");
    if (isGrid()) {
      var spotify = b.type === "spotify";
      more.appendChild(el("p", "hint", "Para cambiar las casillas que ocupa, arrastrá la esquina en la vista previa. Acá podés escribir el número exacto."));
      var cols = field("Columnas", "number", b.cols || 1, function (v) { b.cols = clamp(v, spotify ? 3 : 1, 6); }, spotify ? 3 : 1, 6);
      cols.querySelector("input").id = "grid-cols";
      more.appendChild(cols);
      var rows = field("Filas", "number", b.rows || 1, function (v) { b.rows = clamp(v, spotify ? 2 : 1, 4); }, spotify ? 2 : 1, 4);
      rows.querySelector("input").id = "grid-rows";
      more.appendChild(rows);
    } else {
      var geometry = el("div", "geometry-fields");
      [["X", "x", 0, 1024], ["Y", "y", 0, page().height], ["Ancho", "w", 64, 1024], ["Alto", "h", 50, page().height]].forEach(function (entry) {
        var control = field(entry[0], "number", b[entry[1]], function (v) {
          b[entry[1]] = v;
          b.w = clamp(b.w, b.type === "spotify" ? 320 : 64, 1024); b.h = clamp(b.h, b.type === "spotify" ? 220 : 50, page().height);
          b.x = clamp(b.x, 0, 1024 - b.w); b.y = clamp(b.y, 0, page().height - b.h);
        }, entry[2], entry[3]);
        control.querySelector("input").id = "geo-" + entry[1];
        geometry.appendChild(control);
      });
      more.appendChild(geometry);
    }
    more.appendChild(field("Color del texto", "color", b.textColor, function (v) { b.textColor = v; }));
    more.appendChild(field("Color del borde", "color", b.borderColor, function (v) { b.borderColor = v; }));
    more.appendChild(field("Grosor del borde", "number", b.borderWidth, function (v) { b.borderWidth = clamp(v, 0, 8); }, 0, 8));
    more.appendChild(field("Esquinas redondeadas", "number", b.radius, function (v) { b.radius = clamp(v, 0, 80); }, 0, 80));
    more.appendChild(field("Tamaño del texto", "number", b.fontSize, function (v) { b.fontSize = clamp(v, 12, 48); }, 12, 48));
    more.appendChild(field("Tamaño del icono", "number", b.iconSize, function (v) { b.iconSize = clamp(v, 20, 120); }, 20, 120));
    more.appendChild(field("Opacidad (%)", "number", b.opacity, function (v) { b.opacity = clamp(v, 30, 100); }, 30, 100));
    more.appendChild(segmented("Alinear texto", [["left", "Izquierda"], ["center", "Centro"], ["right", "Derecha"]], b.textAlign, function (v) { b.textAlign = v; drawButtonControls(); }));
    more.appendChild(choice("Animación", [["none", "Ninguna"], ["pulse", "Pulso"], ["float", "Flotar"], ["glow", "Brillo"]], b.animation, function (v) { b.animation = v; }));
    if (!b.feedback) b.feedback = { mode: "none", activeLabel: "Activo", activeColor: "#b91c1c", activeIcon: "" };
    if (b.type === "button") more.appendChild(choice("Cambio visual al tocar", [["none", "Sin cambio"], ["toggle", "Alternar estado visual"]], b.feedback.mode, function (v) {
      b.feedback.mode = v; drawButtonControls();
    }));
    if (b.feedback.mode === "toggle") {
      more.appendChild(el("p", "hint", "Estado estimado: refleja los toques hechos desde el panel, no los cambios hechos dentro de Discord."));
      more.appendChild(field("Texto cuando está activo", "text", b.feedback.activeLabel, function (v) { b.feedback.activeLabel = v; }));
      more.appendChild(field("Color cuando está activo", "color", b.feedback.activeColor, function (v) { b.feedback.activeColor = v; }));
      more.appendChild(assetPicker("Icono cuando está activo", b.feedback.activeIcon, function (v) { b.feedback.activeIcon = v; }));
      var preview = el("label", "preview-state-control");
      var check = document.createElement("input"); check.type = "checkbox"; check.checked = previewActive;
      check.onchange = function () { previewActive = check.checked; drawPreview(); };
      preview.appendChild(check);
      preview.appendChild(document.createTextNode(" Mostrar estado activo en la vista previa"));
      more.appendChild(preview);
    }

    var row = el("div", "inspector-actions");
    var grid = isGrid();
    row.appendChild(command("Duplicar", duplicate));
    row.appendChild(command(grid ? "Antes" : "Al frente", function () { layer(grid ? -1 : 1); }));
    row.appendChild(command(grid ? "Después" : "Atrás", function () { layer(grid ? 1 : -1); }));
    row.appendChild(command("Eliminar", removeButton, "danger"));
    root.appendChild(row);
    updateCollapseAll();
  }

  // ---------- Boxes: the 6-column grid used as a sizing guide ----------
  var G = PanelLayout.grid, STEP = G.cell + G.gap, SNAP = 10;
  function gridLines(limit, offset) {
    var out = [];
    for (var p = G.pad + offset; p <= limit + 0.5; p += STEP) out.push(p);
    return out;
  }
  function nearest(value, list) {
    var best = null, distance = SNAP + 1;
    for (var i = 0; i < list.length; i++) if (Math.abs(list[i] - value) < distance) { distance = Math.abs(list[i] - value); best = list[i]; }
    return best;
  }
  // Pulls a tile's start or end edge onto the nearest box edge when it is close.
  function snapBox(start, size, limit) {
    var a = nearest(start, gridLines(limit, 0)), z = nearest(start + size, gridLines(limit, G.cell));
    if (a !== null && (z === null || Math.abs(a - start) <= Math.abs(z - start - size))) return a;
    return z !== null ? z - size : start;
  }
  function matchSpan(px, max) {
    for (var n = 1; n <= max; n++) if (Math.abs(PanelLayout.span(n) - px) < 1.5) return n;
    return 0;
  }
  function sizeLabel(w, h) {
    var c = matchSpan(w, G.cols), r = matchSpan(h, 8);
    return c && r ? c + " × " + r + " casillas" : Math.round(w) + " × " + Math.round(h) + " px";
  }
  function drawGuides(canvas, layout) {
    var old = canvas.querySelector(".grid-guides"), guides = el("div", "grid-guides" + (layout.grid ? "" : " free"));
    var rows = Math.max(1, Math.floor((layout.height - G.pad + G.gap) / STEP));
    for (var r = 0; r < rows; r++) for (var c = 0; c < G.cols; c++) {
      var cell = el("span", "grid-guide");
      PanelLayout.position(cell, { x: G.pad + c * STEP, y: G.pad + r * STEP, w: G.cell, h: G.cell });
      guides.appendChild(cell);
    }
    if (old) canvas.replaceChild(guides, old);
    else {
      var bg = canvas.querySelector(".canvas-background");
      canvas.insertBefore(guides, bg ? bg.nextSibling : canvas.firstChild);
    }
  }
  // Moves existing tiles to a new layout; CSS animates the change while resizing.
  function reflow() {
    var canvas = $("preview-canvas"), layout = PanelLayout.layout(page(), folderId);
    layout.items.forEach(function (item) { var n = nodeFor(item.id); if (n) PanelLayout.position(n, layout.boxes[item.id]); });
    scale = PanelLayout.fit($("preview-shell"), canvas, layout.height);
    drawGuides(canvas, layout);
  }
  // ---------- Preview ----------
  function addHandles(node) {
    // One handle per corner: tl, tr, bl, br. In grid pages they change the boxes the tile spans.
    var grid = isGrid();
    ["tl", "tr", "bl", "br"].forEach(function (corner) {
      var handle = el("span", "resize-handle " + corner);
      handle.setAttribute("data-handle", (grid ? "span-" : "") + corner);
      handle.title = grid ? "Arrastrá para ocupar más o menos casillas" : "Arrastrá para cambiar el tamaño";
      node.appendChild(handle);
    });
  }
  // Selection changes restyle nodes in place, so double-clicks and drags keep their target.
  function select(id) {
    if (selectedId === id) return;
    selectedId = id; previewActive = false;
    var nodes = $("preview-canvas").querySelectorAll("[data-id]");
    for (var i = 0; i < nodes.length; i++) {
      var on = nodes[i].getAttribute("data-id") === id, handles = nodes[i].querySelectorAll(".resize-handle");
      nodes[i].classList.toggle("is-selected", on);
      nodes[i].classList.remove("feedback-active");
      for (var j = 0; j < handles.length; j++) nodes[i].removeChild(handles[j]);
      if (on) addHandles(nodes[i]);
    }
    drawButtonControls();
  }
  function enterFolder(id) {
    folderId = id; selectedId = null;
    drawButtonControls(); drawPreview();
  }
  function leaveFolder() {
    var from = folderId;
    folderId = ""; selectedId = null;
    drawButtonControls(); drawPreview();
    var tile = nodeFor(from);
    if (tile) Motion.flash(tile, "is-new", 500);
  }
  function renderButton(b, canvas, box, grid) {
    var node = document.createElement(b.type === "spotify" ? "div" : "button");
    if (b.type !== "spotify") node.type = "button";
    else node.tabIndex = 0;
    var activeState = b.id === selectedId && previewActive && b.feedback && b.feedback.mode === "toggle";
    node.className = "action-canvas designer-button animate-" + b.animation + (b.id === selectedId ? " is-selected" : "") + (activeState ? " feedback-active" : "");
    node.setAttribute("data-id", b.id);
    PanelLayout.position(node, box); PanelLayout.paint(node, b, page(), activeState);
    if (b.type === "spotify") node.querySelector(".spotify-status").textContent = "";
    if (b.id === selectedId) addHandles(node);
    node.onmousedown = function (event) { beginDrag(event, b); };
    node.onclick = function () { select(b.id); };
    if (b.type === "spotify") node.onkeydown = function (event) { if (event.keyCode === 13 || event.keyCode === 32) { event.preventDefault(); node.onclick(); } };
    node.ondblclick = function () { if (b.type === "folder") enterFolder(b.id); };
    canvas.appendChild(node);
  }
  function drawPreview(animate) {
    if (!model) return;
    var p = page(), currentFolder = null, canvas = $("preview-canvas");
    var before = animate === true ? Motion.measure(canvas) : animate || null;
    for (var i = 0; i < p.buttons.length; i++) if (p.buttons[i].id === folderId && p.buttons[i].type === "folder") currentFolder = p.buttons[i];
    if (!currentFolder) folderId = "";
    clear(canvas);
    var layout = PanelLayout.layout(p, folderId);
    PanelLayout.background(canvas, p);
    drawGuides(canvas, layout);
    layout.items.forEach(function (b) { renderButton(b, canvas, layout.boxes[b.id], layout.grid); });
    if (!layout.items.length) canvas.appendChild(el("p", "canvas-empty", folderId ? "Carpeta vacía · agregá un botón" : "Agregá un botón para empezar"));
    var trail = $("folder-navigation"); clear(trail);
    if (folderId) {
      var back = command("‹ " + p.title, leaveFolder, "crumb-back");
      back.title = "Volver a la página (Esc)";
      trail.appendChild(back);
      trail.appendChild(el("span", "crumb-separator", "/"));
      trail.appendChild(el("strong", "crumb-current", currentFolder.label));
    } else trail.appendChild(el("strong", "crumb-current", p.title || "Página"));
    $("add-folder").disabled = !!folderId;
    $("stage-hint").textContent = layout.grid
      ? "Arrastrá para reordenar · Arrastrá la esquina para ocupar más casillas · Doble clic en una carpeta para abrirla"
      : "Arrastrá para mover · Las esquinas cambian el tamaño y se ajustan a las casillas · Alt para mover sin imán";
    scale = PanelLayout.fit($("preview-shell"), canvas, layout.height);
    Motion.glide(canvas, before, scale);
  }
  function syncGeometry() {
    var b = selected(); if (!b) return;
    ["x", "y", "w", "h"].forEach(function (key) {
      var input = $("geo-" + key); if (input) input.value = b[key];
    });
  }

  // ---------- Direct manipulation ----------
  function beginDrag(event, b) {
    if (event.button !== 0) return;
    event.preventDefault();
    select(b.id);
    var handle = event.target.getAttribute("data-handle") || "move";
    if (handle.indexOf("span-") === 0) { beginSpanResize(event, b, handle.slice(5)); return; }
    if (isGrid()) { beginGridDrag(event, b); return; }
    var node = nodeFor(b.id), canvas = $("preview-canvas"), badge = null;
    var startX = event.clientX, startY = event.clientY, moved = false;
    var origin = { x: b.x, y: b.y, w: b.w, h: b.h }, minW = b.type === "spotify" ? 320 : 64, minH = b.type === "spotify" ? 220 : 50;
    function move(e) {
      // Track 1:1 from where the tile was grabbed; box edges attract unless Alt is held.
      var dx = (e.clientX - startX) / scale, dy = (e.clientY - startY) / scale, magnet = !e.altKey;
      var width = 1024, height = page().height, hit, w, h;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      if (!moved) {
        moved = true; node.classList.add("is-dragging"); canvas.classList.add("is-dragging-tile");
        badge = el("span", "span-badge"); node.appendChild(badge);
      }
      if (handle === "move") {
        var x = origin.x + dx, y = origin.y + dy;
        if (magnet) { x = snapBox(x, origin.w, width); y = snapBox(y, origin.h, height); }
        b.x = Math.round(clamp(x, 0, width - b.w));
        b.y = Math.round(clamp(y, 0, height - b.h));
      } else {
        // The opposite corner stays fixed; top/left corners move the start edge.
        if (handle.charAt(0) === "t") {
          var top = origin.y + dy;
          if (magnet) { hit = nearest(top, gridLines(height, 0)); if (hit !== null) top = hit; }
          b.y = Math.round(clamp(top, 0, origin.y + origin.h - minH));
          b.h = origin.h + origin.y - b.y;
        } else {
          h = origin.h + dy;
          if (magnet) { hit = nearest(origin.y + h, gridLines(height, G.cell)); if (hit !== null) h = hit - origin.y; }
          b.h = Math.round(clamp(h, minH, height - origin.y));
        }
        if (handle.charAt(1) === "r") {
          w = origin.w + dx;
          if (magnet) { hit = nearest(origin.x + w, gridLines(width, G.cell)); if (hit !== null) w = hit - origin.x; }
          b.w = Math.round(clamp(w, minW, width - origin.x));
        } else {
          var left = origin.x + dx;
          if (magnet) { hit = nearest(left, gridLines(width, 0)); if (hit !== null) left = hit; }
          b.x = Math.round(clamp(left, 0, origin.x + origin.w - minW));
          b.w = origin.w + origin.x - b.x;
        }
      }
      PanelLayout.position(node, b);
      badge.textContent = handle === "move" ? Math.round(b.x) + ", " + Math.round(b.y) : sizeLabel(b.w, b.h);
      syncGeometry();
    }
    function end() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", end);
      node.classList.remove("is-dragging"); canvas.classList.remove("is-dragging-tile");
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
      if (moved) { changed(); drawButtonControls(); }
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", end);
  }
  // Grid corner handles: the tile grows box by box and the others make room live.
  // Dragging away from the tile grows it from any corner; the grid keeps its slot.
  function beginSpanResize(event, b, corner) {
    var sx = corner.charAt(1) === "l" ? -1 : 1, sy = corner.charAt(0) === "t" ? -1 : 1;
    var canvas = $("preview-canvas"), node = nodeFor(b.id), startX = event.clientX, startY = event.clientY;
    var box = PanelLayout.layout(page(), folderId).boxes[b.id], before = [b.cols || 1, b.rows || 1];
    var minC = b.type === "spotify" ? 3 : 1, minR = b.type === "spotify" ? 2 : 1;
    var badge = el("span", "span-badge", before[0] + " × " + before[1]);
    canvas.classList.add("is-resizing"); node.appendChild(badge);
    function move(e) {
      var w = box.w + sx * (e.clientX - startX) / scale, h = box.h + sy * (e.clientY - startY) / scale;
      var c = clamp(Math.round((w + G.gap) / STEP), minC, G.cols), r = clamp(Math.round((h + G.gap) / STEP), minR, G.rows);
      badge.textContent = c + " × " + r;
      if (c === (b.cols || 1) && r === (b.rows || 1)) return;
      b.cols = c; b.rows = r;
      reflow();
    }
    function end() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", end);
      if (badge.parentNode) badge.parentNode.removeChild(badge);
      setTimeout(function () { canvas.classList.remove("is-resizing"); }, 360);
      if ((b.cols || 1) !== before[0] || (b.rows || 1) !== before[1]) { changed(); drawButtonControls(); }
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", end);
  }
  function beginGridDrag(event, b) {
    var node = nodeFor(b.id), canvas = $("preview-canvas");
    var startX = event.clientX, startY = event.clientY, targetId = null, lifted = false;
    function move(e) {
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (!lifted) {
        if (Math.abs(dx) + Math.abs(dy) < 6) return;
        lifted = true; node.classList.add("is-lifted"); Motion.transition(node, "none");
      }
      // The tile stays glued to the pointer; the slot under it shows where it will land.
      Motion.transform(node, "translate(" + dx / scale + "px," + dy / scale + "px) scale(1.04)");
      var rect = canvas.getBoundingClientRect(), x = (e.clientX - rect.left) / scale, y = (e.clientY - rect.top) / scale;
      var layout = PanelLayout.layout(page(), folderId); targetId = null;
      layout.items.forEach(function (item) {
        var box = layout.boxes[item.id];
        if (item.id !== b.id && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) targetId = item.id;
      });
      var nodes = canvas.querySelectorAll("[data-id]");
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle("drop-target", nodes[i].getAttribute("data-id") === targetId);
    }
    function end() {
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", end);
      if (!lifted) return;
      if (targetId) {
        var list = page().buttons, from = list.indexOf(b), target = null;
        for (var i = 0; i < list.length; i++) if (list[i].id === targetId) target = list[i];
        var to = list.indexOf(target); list.splice(from, 1); list.splice(to, 0, b); changed();
      }
      drawPreview(true);
    }
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", end);
  }

  // ---------- Commands ----------
  function drawAll(before) {
    $("panel-title").value = model.title;
    drawPageList(); drawPageControls(); drawButtonControls(); drawPreview(before);
  }
  function addButton(kind) {
    if (!model) return;
    if (page().buttons.length >= 80) { message("Máximo 80 elementos por página.", "error"); return; }
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
    page().buttons.push(b); selectedId = b.id; changed(); drawPageList(); drawButtonControls(); drawPreview(true);
    var node = nodeFor(b.id);
    if (node) { Motion.flash(node, "is-new", 500); if (node.scrollIntoView) node.scrollIntoView({ block: "nearest" }); }
  }
  function removeButton() {
    var b = selected(); if (!b) return;
    if (b.type === "folder" && PanelLayout.items(page(), b.id).length) {
      var root = $("button-controls"); clear(root);
      var card = el("div", "confirm-card");
      card.appendChild(el("h2", "", "¿Eliminar «" + b.label + "»?"));
      card.appendChild(el("p", "hint", "La carpeta tiene botones. Elegí qué hacer con ellos."));
      card.appendChild(command("Conservar botones en la página", function () { finishRemove(b, false); }, "primary full"));
      card.appendChild(command("Eliminar carpeta y contenido", function () { if (confirm("¿Eliminar también todos sus botones?")) finishRemove(b, true); }, "danger full"));
      card.appendChild(command("Cancelar", drawButtonControls, "full"));
      root.appendChild(card);
      return;
    }
    finishRemove(b, false);
  }
  function finishRemove(b, contents) {
    page().buttons = page().buttons.filter(function (item) {
      if (item.id === b.id || (contents && item.folderId === b.id)) return false;
      if (item.folderId === b.id) item.folderId = "";
      return true;
    });
    selectedId = null; changed(); drawPageList(); drawButtonControls(); drawPreview(true);
    message("«" + b.label + "» eliminado · Ctrl+Z para deshacer", "info");
  }
  function duplicate() {
    var b = selected(); if (!b) return;
    var children = b.type === "folder" ? PanelLayout.items(page(), b.id) : [];
    if (page().buttons.length + 1 + children.length > 80) { message("Máximo 80 elementos por página.", "error"); return; }
    var copy = JSON.parse(JSON.stringify(b));
    copy.id = uid(); copy.x = clamp(copy.x + 28, 0, 1024 - copy.w); copy.y = clamp(copy.y + 28, 0, page().height - copy.h);
    children.forEach(function (child) { var clone = JSON.parse(JSON.stringify(child)); clone.id = uid(); clone.folderId = copy.id; page().buttons.push(clone); });
    page().buttons.push(copy); selectedId = copy.id; changed(); drawPageList(); drawButtonControls(); drawPreview(true);
    Motion.flash(nodeFor(copy.id), "is-new", 500);
  }
  function layer(direction) {
    var list = page().buttons, visible = PanelLayout.items(page(), folderId), b = selected();
    if (!b) return;
    var index = visible.indexOf(b), target = index + direction;
    if (target < 0 || target >= visible.length) return;
    var from = list.indexOf(b), to = list.indexOf(visible[target]);
    list.splice(from, 1); list.splice(to, 0, b); changed(); drawPreview(true);
  }
  function nudge(dx, dy) {
    var b = selected();
    if (!b || isGrid()) return;
    b.x = clamp(b.x + dx, 0, 1024 - b.w); b.y = clamp(b.y + dy, 0, page().height - b.h);
    var node = nodeFor(b.id);
    if (node) PanelLayout.position(node, b);
    syncGeometry(); changed("nudge");
  }
  function save() {
    if (!model || !dirty) return;
    $("save").disabled = true;
    request("POST", "/api/config", model, function (err, data) {
      if (err) { $("save").disabled = false; message(err, "error"); return; }
      model = data;
      savedJSON = JSON.stringify(model);
      if (history[history.length - 1] !== savedJSON) history.push(savedJSON);
      setDirty(false);
      message("Cambios guardados. El iPad se actualiza en unos segundos.", "success");
      drawAll();
    });
  }
  function movePage(direction) {
    var target = pageIndex + direction;
    if (target < 0 || target >= model.pages.length) return;
    var item = model.pages.splice(pageIndex, 1)[0]; model.pages.splice(target, 0, item);
    pageIndex = target; changed(); drawPageList();
  }

  $("panel-title").oninput = function () { if (model) { model.title = this.value; changed(this); } };
  $("add-page").onclick = function () {
    if (!model || model.pages.length >= 12) { message("Máximo 12 páginas.", "error"); return; }
    model.pages.push({ id: uid(), title: "Nueva página", layout: "grid", height: 620, backgroundColor: "#161618", backgroundImage: "", backgroundAnimation: "none", buttons: [] });
    pageIndex = model.pages.length - 1; folderId = ""; selectedId = null; changed(); drawAll();
  };
  $("delete-page").onclick = function () {
    if (model.pages.length < 2) { message("Debe quedar al menos una página.", "error"); return; }
    if (!confirm("¿Eliminar la página «" + page().title + "» y sus botones?")) return;
    model.pages.splice(pageIndex, 1); pageIndex = Math.max(0, pageIndex - 1); folderId = ""; selectedId = null; changed(); drawAll();
    message("Página eliminada · Ctrl+Z para deshacer", "info");
  };
  $("page-up").onclick = function () { movePage(-1); };
  $("page-down").onclick = function () { movePage(1); };
  $("add-button").onclick = function () { addButton("button"); };
  $("add-folder").onclick = function () { if (!folderId) addButton("folder"); };
  $("add-spotify").onclick = function () { addButton("spotify"); };
  $("save").onclick = save;
  $("undo").onclick = undo;
  $("redo").onclick = redo;

  document.addEventListener("keydown", function (e) {
    var key = (e.key || "").toLowerCase(), mod = e.ctrlKey || e.metaKey;
    var focus = document.activeElement, typing = focus && /^(INPUT|SELECT|TEXTAREA)$/.test(focus.tagName) && focus.type !== "checkbox";
    if (mod && key === "s") { e.preventDefault(); save(); return; }
    if (typing || !model) return;
    if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && key === "y") { e.preventDefault(); redo(); return; }
    if (mod && key === "d") { e.preventDefault(); duplicate(); return; }
    if (key === "escape") {
      if (selected()) { select(null); }
      else if (folderId) leaveFolder();
      return;
    }
    if (!selected()) return;
    if (key === "delete" || key === "backspace") { e.preventDefault(); removeButton(); return; }
    var step = e.shiftKey ? 10 : 1;
    if (key === "arrowleft") { e.preventDefault(); nudge(-step, 0); }
    else if (key === "arrowright") { e.preventDefault(); nudge(step, 0); }
    else if (key === "arrowup") { e.preventDefault(); nudge(0, -step); }
    else if (key === "arrowdown") { e.preventDefault(); nudge(0, step); }
  });
  // Clicking empty canvas clears the selection.
  $("preview-canvas").addEventListener("mousedown", function (e) {
    if (e.target === this || /canvas-background|canvas-empty/.test(e.target.className)) select(null);
  });

  // ---------- Backup ----------
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
    if (dirty) { message("Guardá los cambios antes de exportar la personalización.", "error"); $("save").focus(); return; }
    backupBusy = true; message("Preparando respaldo…");
    transfer("GET", "/api/backup", null, function (err, blob) {
      backupBusy = false; if (err) { message(err, "error"); return; }
      var url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = "mi-panel.zip"; document.body.appendChild(link); link.click(); document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      message("Respaldo descargado. Incluye botones, carpetas e imágenes.", "success");
    });
  };
  $("import-backup").onchange = function () {
    var file = this.files[0]; this.value = "";
    if (!file || backupBusy) return;
    if (file.size > 505000000) { message("El respaldo supera el máximo de 505 MB.", "error"); return; }
    var root = $("restore-preview"); clear(root); backupBusy = true; message("Validando respaldo…");
    transfer("POST", "/api/restore?preview=1", file, function (err, info) {
      backupBusy = false; if (err) { message(err, "error"); return; }
      var summary = el("p", "restore-summary");
      summary.textContent = info.title + " · " + info.pages + " páginas · " + info.folders + " carpetas · " + info.buttons + " botones · " + (info.widgets || 0) + " tarjetas Spotify. Se reemplazará el panel actual y se guardará una copia previa en data/.";
      root.appendChild(summary);
      var restoreButton = command("Reemplazar con este respaldo", function () {
        if (backupBusy) return;
        if (dirty && !confirm("Hay cambios sin guardar. ¿Descartarlos y restaurar el respaldo?")) return;
        backupBusy = true; restoreButton.disabled = true; message("Restaurando…");
        transfer("POST", "/api/restore", file, function (error, result) {
          backupBusy = false; restoreButton.disabled = false;
          if (error) { message(error, "error"); return; }
          model = result.config; folderId = ""; selectedId = null; pageIndex = 0;
          resetHistory();
          clear(root); drawAll(); loadAssets(); message("Personalización restaurada. Copia anterior: data/" + result.backup, "success");
        });
      }, "primary full");
      root.appendChild(restoreButton); root.appendChild(command("Cancelar", function () { if (!backupBusy) clear(root); }, "full"));
      message("Respaldo válido. Revisá el resumen antes de reemplazar el panel.", "info");
    });
  };
  window.onresize = function () { if (model) drawPreview(); };
  window.onbeforeunload = function () { if (dirty) return "Hay cambios sin guardar."; };
  drawEmptyInspector($("button-controls"));
  if (token) load(); else localToken();
}());
