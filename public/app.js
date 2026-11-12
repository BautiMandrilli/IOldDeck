(function () {
  "use strict";
  var tokenMatch = location.hash.match(/(?:^#|&)t=([a-f0-9]+)/i);
  if (tokenMatch) {
    localStorage.setItem("panel_token", tokenMatch[1]);
    history.replaceState(null, "", location.pathname);
  }
  var token = localStorage.getItem("panel_token") || "";
  var pages = [];
  var active = 0;
  var openFolderId = "";
  var folderTrigger = null;
  var messageTimer;
  var signature = "";
  var tabSignature = "";
  var states = {};
  var stateSignature = "";
  var stateVersion = -1;
  var stateEpoch = "";
  var pairing = false;
  var TRANSIENT = ["is-pressed", "is-busy", "did-fire", "did-fail"];

  // Horizontal offset of the current page; driven by touch, then by a spring.
  var offset = 0, swipe = null;
  var spring = new Motion.Spring(function (x) {
    offset = x;
    var track = $("page-track");
    if (track) Motion.transform(track, Math.abs(x) < 0.01 ? "" : "translate3d(" + x + "px,0,0)");
  });

  function $(id) { return document.getElementById(id); }
  if (navigator.standalone) document.body.classList.add("is-standalone");

  function request(method, path, body, done) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, path, true);
    xhr.setRequestHeader("X-Panel-Token", token);
    if (body) xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var result;
      try { result = JSON.parse(xhr.responseText); } catch (e) { result = {}; }
      if (xhr.status >= 200 && xhr.status < 300) done(null, result, xhr.status);
      else done(result.error || "Sin conexión con la computadora", null, xhr.status);
    };
    xhr.onerror = function () { done("Sin conexión con la computadora", null, 0); };
    xhr.send(body ? JSON.stringify(body) : null);
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function showMessage(text, kind) {
    var layer = $("message"), toast = layer.firstChild;
    if (!toast) { toast = document.createElement("span"); layer.appendChild(toast); }
    toast.textContent = text;
    toast.className = "toast " + (kind || "info") + " visible";
    clearTimeout(messageTimer);
    messageTimer = setTimeout(function () { toast.className = "toast " + (kind || "info"); }, 2600);
  }
  function setStatus(ok) {
    var el = $("status");
    el.querySelector(".status-text").textContent = ok ? "Conectado" : "Sin conexión";
    el.className = ok ? "status online" : "status offline";
  }
  function showPair(show) {
    if (show) closeFolder(true);
    $("pair").style.display = show ? "block" : "none";
    $("pages").style.display = show ? "none" : "block";
    $("tabs").style.display = show ? "none" : "";
    if (show) setTimeout(function () { $("pair-code").focus(); }, 50);
  }

  function itemClass(item, on, el) {
    var name = "action-canvas animate-" + item.animation + (on ? " feedback-active" : "");
    if (el) TRANSIENT.forEach(function (c) { if (el.classList.contains(c)) name += " " + c; });
    return name;
  }
  function run(id, button) {
    button.disabled = true;
    button.classList.add("is-busy");
    request("POST", "/api/action", { id: id }, function (err, data, status) {
      button.disabled = false;
      button.classList.remove("is-busy");
      setStatus(status !== 0);
      if (!err && data.states) applyStates(data);
      Motion.flash(button, err ? "did-fail" : "did-fire", 600);
      if (err) showMessage(err, "error");
      else if (data.opened === "web") showMessage("La app no está instalada en la PC: se abrió su página web", "info");
    });
  }
  function applyStates(response) {
    if (response.epoch !== stateEpoch) { stateEpoch = response.epoch; stateVersion = -1; }
    if (response.version < stateVersion) return;
    stateVersion = response.version;
    var next = response.states;
    var nextSignature = JSON.stringify(next);
    if (stateSignature === nextSignature) return;
    states = next;
    stateSignature = nextSignature;
    if (pages.length) refreshButtons();
  }
  function refreshStates() {
    if (!token) return;
    request("GET", "/api/state", null, function (err, data) {
      if (!err && data.states) applyStates(data);
    });
  }
  // Repaint in place: the nodes (and any touch in progress) are kept.
  function refreshButtons() {
    var page = pages[active];
    if (!page) return;
    var nodes = document.querySelectorAll("button[data-id]");
    for (var i = 0; i < nodes.length; i++) {
      var id = nodes[i].getAttribute("data-id");
      for (var j = 0; j < page.buttons.length; j++) if (page.buttons[j].id === id) {
        var item = page.buttons[j], on = item.feedback.mode === "toggle" && states[id] === true;
        nodes[i].className = itemClass(item, on, nodes[i]);
        PanelLayout.paint(nodes[i], item, page, on);
      }
    }
  }
  function renderCanvas(page, parent, folderId) {
    var shell = document.createElement("div"); shell.className = "canvas-shell";
    var canvas = document.createElement("div"); canvas.className = "dashboard-canvas";
    var layout = PanelLayout.layout(page, folderId);
    if (!folderId) PanelLayout.background(canvas, page);
    layout.items.forEach(function (item) {
      var button = document.createElement(item.type === "spotify" ? "div" : "button");
      if (item.type !== "spotify") button.type = "button";
      var on = item.feedback.mode === "toggle" && states[item.id] === true;
      button.className = itemClass(item, on);
      button.setAttribute("data-id", item.id);
      if (item.type === "folder") button.setAttribute("aria-haspopup", "dialog");
      PanelLayout.position(button, layout.boxes[item.id]);
      PanelLayout.paint(button, item, page, on);
      if (item.type === "spotify") button.setAttribute("data-live-spotify", "true");
      else Motion.pressable(button);
      button.onclick = function () {
        if (item.type === "folder") { folderTrigger = button; openFolderId = item.id; drawFolder(); }
        else if (item.type === "button") run(item.id, button);
      };
      canvas.appendChild(button);
    });
    if (!layout.items.length) {
      var empty = document.createElement("p"); empty.className = "canvas-empty";
      empty.textContent = folderId ? "Esta carpeta está vacía" : "Agregá botones desde el editor de la PC";
      canvas.appendChild(empty);
    }
    shell.appendChild(canvas); parent.appendChild(shell);
    PanelLayout.fit(shell, canvas, layout.height);
    if (window.SpotifyCards) SpotifyCards.mount();
  }

  // Folders grow out of the tile that opened them and shrink back into it.
  function closeFolder(immediate) {
    openFolderId = "";
    var overlay = $("folder-overlay");
    if (overlay) {
      overlay.removeAttribute("id");
      if (immediate) overlay.parentNode.removeChild(overlay);
      else {
        overlay.className += " is-closing is-hidden";
        setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 320);
      }
    }
    document.body.classList.remove("folder-is-open");
    $("pages").removeAttribute("aria-hidden");
    $("tabs").removeAttribute("aria-hidden");
    if (folderTrigger && document.body.contains(folderTrigger)) folderTrigger.focus();
  }
  function anchorToTrigger(dialog) {
    if (!folderTrigger || !document.body.contains(folderTrigger)) return;
    var t = folderTrigger.getBoundingClientRect(), d = dialog.getBoundingClientRect();
    var left = d.left + d.width / 2 - dialog.offsetWidth / 2, top = d.top + d.height / 2 - dialog.offsetHeight / 2;
    var origin = Math.round(t.left + t.width / 2 - left) + "px " + Math.round(t.top + t.height / 2 - top) + "px";
    dialog.style.webkitTransformOrigin = origin;
    dialog.style.transformOrigin = origin;
  }
  function drawFolder() {
    var previous = $("folder-overlay"), oldScroll = 0, fresh = !previous;
    if (previous) {
      oldScroll = previous.querySelector(".folder-dialog").scrollTop;
      previous.parentNode.removeChild(previous);
    }
    if (!openFolderId) return;
    var page = pages[active], folder = null;
    for (var i = 0; i < page.buttons.length; i++) if (page.buttons[i].id === openFolderId && page.buttons[i].type === "folder") folder = page.buttons[i];
    if (!folder) { closeFolder(true); return; }
    var overlay = document.createElement("div"); overlay.id = "folder-overlay";
    overlay.className = "folder-overlay" + (fresh ? " is-hidden" : "");
    var dialog = document.createElement("section"); dialog.className = "folder-dialog";
    dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true"); dialog.setAttribute("aria-labelledby", "folder-title");
    var heading = document.createElement("div"); heading.className = "folder-heading";
    var title = document.createElement("h2"); title.id = "folder-title"; title.textContent = folder.label;
    var close = document.createElement("button"); close.type = "button"; close.className = "sheet-close";
    close.setAttribute("aria-label", "Cerrar"); close.title = "Cerrar";
    close.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
    close.onclick = function () { closeFolder(); };
    Motion.pressable(close);
    heading.appendChild(title); heading.appendChild(close); dialog.appendChild(heading);
    overlay.appendChild(dialog); document.body.appendChild(overlay);
    renderCanvas(page, dialog, openFolderId);
    dialog.scrollTop = oldScroll;
    overlay.onclick = function (e) { if (e.target === overlay) closeFolder(); };
    dialog.onkeydown = function (e) {
      if (e.keyCode !== 9) return;
      var controls = dialog.querySelectorAll("button"), first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    if (fresh) {
      anchorToTrigger(dialog);
      void overlay.offsetWidth;
      overlay.classList.remove("is-hidden");
    }
    document.body.classList.add("folder-is-open");
    $("pages").setAttribute("aria-hidden", "true");
    $("tabs").setAttribute("aria-hidden", "true");
    close.focus();
  }

  // Page tabs: a floating pill whose indicator slides to the selected page.
  function selectTab(index) {
    var tabs = $("tabs").querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("selected", i === index);
      if (i === index) tabs[i].setAttribute("aria-current", "page"); else tabs[i].removeAttribute("aria-current");
    }
    var tab = tabs[index], indicator = $("tabs").querySelector(".tab-indicator");
    if (!tab || !indicator) return;
    var first = !indicator.style.width;
    if (first) Motion.transition(indicator, "none");
    indicator.style.width = tab.offsetWidth + "px";
    Motion.transform(indicator, "translateX(" + tab.offsetLeft + "px)");
    if (first) { void indicator.offsetWidth; Motion.transition(indicator, ""); }
  }
  function drawTabs() {
    var tabs = $("tabs"), nextSignature = JSON.stringify(pages.map(function (p) { return p.title; }));
    tabs.classList.toggle("is-single", pages.length < 2);
    if (nextSignature !== tabSignature) {
      tabSignature = nextSignature;
      clear(tabs);
      var pill = document.createElement("div"); pill.className = "tabbar-pill";
      var indicator = document.createElement("span"); indicator.className = "tab-indicator";
      pill.appendChild(indicator);
      pages.forEach(function (p, index) {
        var tab = document.createElement("button"); tab.type = "button"; tab.className = "tab";
        tab.textContent = p.title;
        tab.onclick = function () { goTo(index, 0); };
        pill.appendChild(tab);
      });
      tabs.appendChild(pill);
    }
    selectTab(active);
  }
  function draw() {
    var panel = $("pages");
    clear(panel);
    if (!pages.length) return;
    var page = pages[active];
    var track = document.createElement("div"); track.id = "page-track"; track.className = "page-track";
    var heading = document.createElement("h2"); heading.className = "page-title"; heading.textContent = page.title;
    track.appendChild(heading); panel.appendChild(track);
    renderCanvas(page, track, "");
    spring.onUpdate(offset);
    drawTabs();
    drawFolder();
  }

  // Page changes: the old page leaves toward where the finger was going, the new one
  // enters from the opposite side carrying the same velocity.
  function settleBack(velocity) {
    selectTab(active);
    spring.to(0, { velocity: velocity || 0, response: 0.35 });
  }
  function goTo(index, velocity) {
    if (index === active || index < 0 || index >= pages.length) { settleBack(velocity); return; }
    var dir = index > active ? 1 : -1, width = $("pages").clientWidth || window.innerWidth;
    closeFolder(true);
    selectTab(index);
    spring.to(-dir * width, { velocity: velocity, response: 0.26, onRest: function () {
      active = index;
      draw();
      spring.set(dir * width);
      spring.to(0, { velocity: velocity, response: 0.4 });
    } });
  }
  (function swipeBetweenPages() {
    var area = $("pages");
    area.addEventListener("touchstart", function (e) {
      if (pages.length < 2 || openFolderId || e.touches.length !== 1) { swipe = null; return; }
      var t = e.touches[0];
      // Grabbing a page mid-flight stops it where it is; a tap lets it continue.
      var resume = spring.frame ? { target: spring.target, onRest: spring.onRest, response: spring.response } : null;
      spring.stop();
      swipe = { x: t.clientX, y: t.clientY, base: offset, decided: false, horizontal: false, resume: resume, tracker: new Motion.Tracker() };
      swipe.tracker.add(offset);
    }, false);
    area.addEventListener("touchmove", function (e) {
      if (!swipe) return;
      var t = e.touches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
      if (!swipe.decided) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        swipe.decided = true;
        swipe.horizontal = Math.abs(dx) > Math.abs(dy);
        if (!swipe.horizontal) { release(); return; }
        swipe.x += dx > 0 ? 10 : -10;
        dx = t.clientX - swipe.x;
      }
      e.preventDefault();
      var raw = swipe.base + dx, width = area.clientWidth;
      if ((active === 0 && raw > 0) || (active === pages.length - 1 && raw < 0)) raw = Motion.rubberband(raw, width);
      spring.set(raw);
      swipe.tracker.add(raw);
    }, false);
    function release() {
      var s = swipe;
      swipe = null;
      if (!s) return;
      if (!s.horizontal) {
        if (s.resume) spring.to(s.resume.target, { response: s.resume.response, onRest: s.resume.onRest });
        else if (offset) settleBack(0);
        return;
      }
      var v = s.tracker.velocity(), width = area.clientWidth, projected = offset + Motion.project(v);
      if (projected < -width * 0.35 && active < pages.length - 1) goTo(active + 1, v);
      else if (projected > width * 0.35 && active > 0) goTo(active - 1, v);
      else settleBack(v);
    }
    area.addEventListener("touchend", release, false);
    area.addEventListener("touchcancel", release, false);
  }());

  document.addEventListener("keydown", function (e) {
    if (e.keyCode === 27 && openFolderId) closeFolder();
    else if (!openFolderId && (e.keyCode === 37 || e.keyCode === 39) && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      goTo(active + (e.keyCode === 39 ? 1 : -1), 0);
    }
  });
  function load() {
    if (!token) {
      setStatus(false);
      showPair(true);
      return;
    }
    request("GET", "/api/config", null, function (err, data, status) {
      setStatus(status !== 0);
      if (status === 401) {
        token = "";
        localStorage.removeItem("panel_token");
        showPair(true);
        return;
      }
      if (err) { showMessage(err, "error"); return; }
      showPair(false);
      $("title").textContent = data.title;
      document.title = data.title;
      var nextSignature = JSON.stringify(data);
      if (signature === nextSignature) return;
      signature = nextSignature;
      pages = data.pages;
      if (active >= pages.length) active = 0;
      draw();
      refreshStates();
    });
  }
  function pair() {
    var code = $("pair-code").value.replace(/\s/g, "");
    if (pairing) return;
    if (!/^[0-9]{6}$/.test(code)) {
      $("pair-error").textContent = "Escribí los 6 números.";
      Motion.flash(document.querySelector(".pair-card"), "did-fail", 500);
      return;
    }
    pairing = true;
    request("POST", "/api/pair", { code: code }, function (err, data) {
      pairing = false;
      if (err) {
        $("pair-error").textContent = err;
        Motion.flash(document.querySelector(".pair-card"), "did-fail", 500);
        $("pair-code").select();
        return;
      }
      token = data.token;
      localStorage.setItem("panel_token", token);
      $("pair-error").textContent = "";
      $("pair-code").value = "";
      load();
    });
  }
  $("pair-form").onsubmit = function (event) { event.preventDefault(); pair(); };
  $("pair-code").oninput = function () { if (/^[0-9]{6}$/.test(this.value)) pair(); };
  Motion.pressable(document.querySelector("#pair-form button"));
  load();
  window.onresize = function () { if (pages.length) draw(); };
  setInterval(load, 10000);
  setInterval(refreshStates, 2000);
}());
