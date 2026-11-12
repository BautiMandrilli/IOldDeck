/* Development only, injected by the server when started with npm run dev. */
(function () {
  "use strict";
  var pending = false;
  function check() {
    if (pending) return;
    var token = localStorage.getItem("panel_token");
    if (!token) return;
    pending = true;
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/dev-version", true);
    xhr.setRequestHeader("X-Panel-Token", token);
    xhr.timeout = 3000;
    xhr.onload = function () {
      pending = false;
      if (xhr.status !== 200) return;
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
      if (!data.version || data.version === window.panelDevVersion) return;
      if (window.panelHasUnsavedChanges && window.panelHasUnsavedChanges()) {
        var message = document.getElementById("editor-message");
        if (message) message.textContent = "Código actualizado. Guardá tus cambios para recargar automáticamente.";
        return;
      }
      window.location.reload();
    };
    xhr.onerror = xhr.ontimeout = function () { pending = false; };
    xhr.send(null);
  }
  setInterval(check, 1500);
}());
