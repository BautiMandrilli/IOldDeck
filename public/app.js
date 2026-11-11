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
    if (pages.length) draw();
  }
  function refreshStates() {
    if (!token) return;
    request("GET", "/api/state", null, function (err, data) {
      if (!err && data.states) applyStates(data);
    });
  }
  function draw() {
    var panel = document.getElementById("pages");
    var tabs = document.getElementById("tabs");
    clear(panel); clear(tabs);
    if (!pages.length) return;
    var page = pages[active];
    var heading = document.createElement("h2");
    heading.textContent = page.title;
    panel.appendChild(heading);
    var shell = document.createElement("div");
    shell.className = "canvas-shell";
    var canvas = document.createElement("div");
    canvas.className = "dashboard-canvas";
    canvas.style.height = page.height + "px";
    canvas.style.backgroundColor = page.backgroundColor;
    var background = document.createElement("div");
    background.className = "canvas-background bg-" + page.backgroundAnimation;
    if (page.backgroundImage) background.style.backgroundImage = "url('" + page.backgroundImage + "')";
    canvas.appendChild(background);
    for (var i = 0; i < page.buttons.length; i++) {
      var item = page.buttons[i];
      var feedback = item.feedback || { mode: "none" };
      var activeState = feedback.mode === "toggle" && states[item.id] === true;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "action-canvas animate-" + item.animation + (activeState ? " feedback-active" : "");
      button.style.left = item.x + "px";
      button.style.top = item.y + "px";
      button.style.width = item.w + "px";
      button.style.height = item.h + "px";
      button.style.backgroundColor = activeState ? feedback.activeColor : item.backgroundColor;
      button.style.color = item.textColor;
      button.style.borderColor = item.borderColor;
      button.style.borderWidth = item.borderWidth + "px";
      button.style.borderRadius = item.radius + "px";
      button.style.fontSize = item.fontSize + "px";
      button.style.opacity = item.opacity / 100;
      if (item.image) button.style.backgroundImage = "linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.2)),url('" + item.image + "')";
      var content = document.createElement("span");
      content.className = "button-content";
      content.style.textAlign = item.textAlign;
      var visibleIcon = activeState && feedback.activeIcon ? feedback.activeIcon : item.icon;
      if (visibleIcon) {
        var icon = document.createElement("img");
        icon.src = visibleIcon;
        icon.alt = "";
        icon.style.width = item.iconSize + "px";
        icon.style.height = item.iconSize + "px";
        content.appendChild(icon);
      }
      var label = document.createElement("span");
      label.textContent = activeState ? feedback.activeLabel : item.label;
      content.appendChild(label);
      button.appendChild(content);
      if (feedback.mode === "toggle") {
        var badge = document.createElement("span");
        badge.className = "feedback-badge";
        badge.textContent = "ESTIMADO";
        button.appendChild(badge);
        button.title = "Estado estimado según los toques hechos desde este panel";
      }
      button.onclick = (function (id, el) { return function () { run(id, el); }; })(item.id, button);
      canvas.appendChild(button);
    }
    shell.appendChild(canvas);
    panel.appendChild(shell);
    var scale = shell.clientWidth / 1024;
    canvas.style.webkitTransform = "scale(" + scale + ")";
    canvas.style.transform = "scale(" + scale + ")";
    shell.style.height = Math.ceil(page.height * scale) + "px";
    for (var j = 0; j < pages.length; j++) {
      var tab = document.createElement("button");
      tab.type = "button";
      tab.textContent = pages[j].title;
      tab.className = "tab" + (j === active ? " selected" : "");
      tab.onclick = (function (index) { return function () { active = index; draw(); }; })(j);
      tabs.appendChild(tab);
    }
  }
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
