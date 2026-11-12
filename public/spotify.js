/* Local Spotify controller. ES5/XHR for Safari on iOS 9. */
(function () {
  "use strict";
  var state = null, received = 0, pending = false, controlling = false;
  var generation = 0;
  var artRevision = "", artURL = "", artPending = false, mounted = false;
  function cards() { return document.querySelectorAll(".spotify-card[data-live-spotify]"); }
  function request(method, path, body, done) {
    var xhr = new XMLHttpRequest(); xhr.open(method, path, true);
    xhr.setRequestHeader("X-Panel-Token", localStorage.getItem("panel_token") || "");
    if (body) xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = 6000;
    xhr.onload = function () {
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { data = {}; }
      done(xhr.status === 200 ? null : data.error || "No se pudo conectar con Spotify", data);
    };
    xhr.onerror = xhr.ontimeout = function () { done("Sin conexión con la PC"); };
    xhr.send(body ? JSON.stringify(body) : null);
  }
  function time(ms) {
    var sec = Math.floor(Math.max(0, ms) / 1000);
    return Math.floor(sec / 60) + ":" + (sec % 60 < 10 ? "0" : "") + sec % 60;
  }
  function covers() {
    var list = cards();
    for (var i = 0; i < list.length; i++) {
      var img = list[i].querySelector(".spotify-art"), icon = list[i].querySelector(".spotify-cover .system-icon");
      if (artURL) { img.src = artURL; img.style.display = "block"; icon.style.display = "none"; }
      else { img.removeAttribute("src"); img.style.display = "none"; icon.style.display = "block"; }
    }
  }
  function artwork() {
    var revision = state && state.artworkRevision || "";
    if (revision === artRevision && (artURL || !revision)) { covers(); return; }
    if (artPending) return;
    if (artURL) { URL.revokeObjectURL(artURL); artURL = ""; }
    artRevision = revision; covers();
    if (!revision) return;
    artPending = true;
    var xhr = new XMLHttpRequest(); xhr.open("GET", "/api/spotify/artwork?revision=" + encodeURIComponent(revision), true);
    xhr.setRequestHeader("X-Panel-Token", localStorage.getItem("panel_token") || ""); xhr.responseType = "blob"; xhr.timeout = 6000;
    xhr.onload = function () {
      artPending = false;
      if (xhr.status === 200 && state && state.artworkRevision === revision) { artURL = URL.createObjectURL(xhr.response); covers(); }
    };
    xhr.onerror = xhr.ontimeout = function () { artPending = false; };
    xhr.send(null);
  }
  function progress() {
    var list = cards(), s = state;
    if (!s) return;
    var elapsed = Date.now() - received, stale = elapsed + (s.ageMs || 0) > 6000;
    var position = s.positionMs || 0;
    if (s.playing) position += Math.min(6000, elapsed + (s.ageMs || 0));
    position = Math.min(position, s.durationMs || 0);
    var percent = s.durationMs ? Math.max(0, Math.min(100, position / s.durationMs * 100)) : 0;
    for (var i = 0; i < list.length; i++) {
      list[i].querySelector(".spotify-progress-fill").style.width = percent + "%";
      list[i].querySelector(".spotify-progress").setAttribute("aria-valuenow", Math.round(percent));
      list[i].querySelector(".spotify-elapsed").textContent = time(position);
      list[i].querySelector(".spotify-duration").textContent = time(s.durationMs || 0);
      if (stale) {
        list[i].querySelector(".spotify-status").textContent = "Sin conexión con Spotify. Reintentando…";
        var buttons = list[i].querySelectorAll(".spotify-control");
        for (var j = 0; j < buttons.length; j++) buttons[j].disabled = true;
      }
    }
  }
  function render() {
    if (!state) return;
    var list = cards(), s = state;
    for (var i = 0; i < list.length; i++) {
      list[i].querySelector(".spotify-title").textContent = s.title || "Spotify en tu PC";
      list[i].querySelector(".spotify-artist").textContent = s.artist || "";
      list[i].querySelector(".spotify-status").textContent = s.message || (s.playing ? "Reproduciendo en esta PC" : "En pausa");
      var buttons = list[i].querySelectorAll(".spotify-control");
      for (var j = 0; j < buttons.length; j++) {
        var command = buttons[j].getAttribute("data-command");
        buttons[j].disabled = controlling || s.status !== "ready" || !s.controls || !s.controls[command];
        if (command === "playpause") {
          var icon = buttons[j].querySelector("svg");
          var desired = s.playing ? "pause" : "play";
          if (buttons[j].getAttribute("data-icon") !== desired) {
            buttons[j].replaceChild(PanelLayout.symbol(desired, 25), icon); buttons[j].setAttribute("data-icon", desired);
          }
          buttons[j].setAttribute("aria-label", s.playing ? "Pausar" : "Reproducir");
        }
      }
    }
    artwork(); progress();
  }
  function poll() {
    if (pending || !cards().length || !localStorage.getItem("panel_token")) return;
    pending = true;
    var started = generation;
    request("GET", "/api/spotify/state", null, function (error, data) {
      pending = false;
      if (!error && !controlling && started === generation) { state = data; received = Date.now(); render(); }
      else if (error && !state) {
        state = { status: "error", message: error }; received = Date.now(); render();
      }
    });
  }
  window.SpotifyCards = { mount: function () {
    var list = cards();
    for (var i = 0; i < list.length; i++) {
      var buttons = list[i].querySelectorAll(".spotify-control");
      for (var j = 0; j < buttons.length; j++) buttons[j].onclick = function (event) {
        event.stopPropagation();
        if (controlling || !state || this.disabled) return;
        controlling = true; generation++; render();
        request("POST", "/api/spotify/control", { command: this.getAttribute("data-command"), sessionId: state.sessionId }, function (error, data) {
          controlling = false;
          if (!error) { state = data; received = Date.now(); }
          render();
          if (error) {
            var nodes = cards();
            for (var k = 0; k < nodes.length; k++) nodes[k].querySelector(".spotify-status").textContent = error;
          }
          poll();
        });
      }
    }
    render();
    if (!mounted) { mounted = true; setInterval(poll, 2000); setInterval(progress, 1000); }
    poll();
  } };
}());
