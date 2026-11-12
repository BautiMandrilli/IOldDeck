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
  var states = {};
  var stateSignature = "";
  var stateVersion = -1;
  var stateEpoch = "";

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
  function showMessage(text) {
    var el = document.getElementById("message");
    el.textContent = text;
    el.className = "message visible";
    clearTimeout(messageTimer);
    messageTimer = setTimeout(function () { el.className = "message"; }, 2600);
  }
  function setStatus(ok) {
    var el = document.getElementById("status");
    el.textContent = ok ? "Conectado" : "Desconectado";
    el.className = ok ? "status online" : "status offline";
  }
  function showPair(show) {
    if (show) closeFolder();
    document.getElementById("pair").style.display = show ? "block" : "none";
    document.getElementById("pages").style.display = show ? "none" : "block";
    document.getElementById("tabs").style.display = show ? "none" : "flex";
  }
  function run(id, button) {
    button.disabled = true;
    request("POST", "/api/action", { id: id }, function (err, data) {
      button.disabled = false;
      setStatus(!err);
      if (!err && data.states) applyStates(data);
      showMessage(err || "Acción enviada");
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
  function refreshButtons() {
    var page = pages[active];
    if (!page) return;
    var nodes = document.querySelectorAll("button[data-id]");
    for (var i = 0; i < nodes.length; i++) {
      var id = nodes[i].getAttribute("data-id");
      for (var j = 0; j < page.buttons.length; j++) if (page.buttons[j].id === id) {
        var item = page.buttons[j], on = item.feedback.mode === "toggle" && states[id] === true;
        nodes[i].className = "action-canvas animate-" + item.animation + (on ? " feedback-active" : "");
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
      button.className = "action-canvas animate-" + item.animation + (on ? " feedback-active" : "");
      button.setAttribute("data-id", item.id);
      if (item.type === "folder") button.setAttribute("aria-haspopup", "dialog");
      PanelLayout.position(button, layout.boxes[item.id]);
      PanelLayout.paint(button, item, page, on);
      if (item.type === "spotify") button.setAttribute("data-live-spotify", "true");
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
  function closeFolder() {
    openFolderId = "";
    var overlay = document.getElementById("folder-overlay");
    if (overlay) overlay.parentNode.removeChild(overlay);
    document.body.className = "";
    document.getElementById("pages").removeAttribute("aria-hidden");
    document.getElementById("tabs").removeAttribute("aria-hidden");
    if (folderTrigger && document.body.contains(folderTrigger)) folderTrigger.focus();
  }
  function drawFolder() {
    var previous = document.getElementById("folder-overlay"), oldScroll = 0;
    if (previous) {
      oldScroll = previous.querySelector(".folder-dialog").scrollTop;
      previous.parentNode.removeChild(previous);
    }
    if (!openFolderId) return;
    var page = pages[active], folder = null;
    for (var i = 0; i < page.buttons.length; i++) if (page.buttons[i].id === openFolderId && page.buttons[i].type === "folder") folder = page.buttons[i];
    if (!folder) { closeFolder(); return; }
    var overlay = document.createElement("div"); overlay.id = "folder-overlay"; overlay.className = "folder-overlay";
    var dialog = document.createElement("section"); dialog.className = "folder-dialog";
    dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true"); dialog.setAttribute("aria-labelledby", "folder-title");
    var heading = document.createElement("div"); heading.className = "folder-heading";
    var title = document.createElement("h2"); title.id = "folder-title"; title.textContent = folder.label;
    var close = document.createElement("button"); close.type = "button"; close.className = "edit-button"; close.textContent = "Cerrar"; close.onclick = closeFolder;
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
    document.body.className = "folder-is-open";
    document.getElementById("pages").setAttribute("aria-hidden", "true");
    document.getElementById("tabs").setAttribute("aria-hidden", "true");
    close.focus();
  }
  function draw() {
    var panel = document.getElementById("pages"), tabs = document.getElementById("tabs");
    clear(panel); clear(tabs);
    if (!pages.length) return;
    var page = pages[active];
    var heading = document.createElement("h2"); heading.textContent = page.title;
    panel.appendChild(heading); renderCanvas(page, panel, "");
    for (var j = 0; j < pages.length; j++) {
      var tab = document.createElement("button"); tab.type = "button"; tab.textContent = pages[j].title;
      tab.className = "tab" + (j === active ? " selected" : "");
      tab.onclick = (function (index) { return function () { closeFolder(); active = index; draw(); }; })(j);
      tabs.appendChild(tab);
    }
    drawFolder();
  }
  document.addEventListener("keydown", function (e) { if (e.keyCode === 27 && openFolderId) closeFolder(); });
  function load() {
    if (!token) {
      setStatus(false);
      showPair(true);
      return;
    }
    request("GET", "/api/config", null, function (err, data, status) {
      setStatus(!err);
      if (status === 401) {
        token = "";
        localStorage.removeItem("panel_token");
        showPair(true);
        return;
      }
      if (err) { showMessage(err); return; }
      showPair(false);
      document.getElementById("title").textContent = data.title;
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
  document.getElementById("pair-form").onsubmit = function (event) {
    event.preventDefault();
    var code = document.getElementById("pair-code").value.replace(/\s/g, "");
    if (!/^[0-9]{6}$/.test(code)) {
      document.getElementById("pair-error").textContent = "Escribí los 6 números.";
      return;
    }
    request("POST", "/api/pair", { code: code }, function (err, data) {
      if (err) { document.getElementById("pair-error").textContent = err; return; }
      token = data.token;
      localStorage.setItem("panel_token", token);
      document.getElementById("pair-error").textContent = "";
      document.getElementById("pair-code").value = "";
      load();
    });
  };
  load();
  window.onresize = function () { if (pages.length) draw(); };
  setInterval(load, 10000);
  setInterval(refreshStates, 2000);
}());
