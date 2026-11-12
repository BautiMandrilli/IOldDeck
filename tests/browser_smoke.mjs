// Local Chrome smoke test using CDP and Node built-ins; never touches user data/.
import { spawn } from 'node:child_process';
import { mkdtemp, cp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'panel-qa-'));
let python, chrome, socket;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 150; i++) {
    try { const value = await fn(); if (value) return value; } catch (_) { /* startup */ }
    await delay(100);
  }
  throw new Error('Timeout: ' + label);
}
try {
  await cp(path.join(root, 'server.py'), path.join(temporary, 'server.py'));
  await cp(path.join(root, 'spotify_bridge.py'), path.join(temporary, 'spotify_bridge.py'));
  await cp(path.join(root, 'public'), path.join(temporary, 'public'), { recursive: true });
  python = spawn(process.env.PYTHON || 'python', ['-u', '-c',
    'import importlib.util,sys; sys.path.insert(0,sys.argv[2]); from test_spotify import Backend; s=importlib.util.spec_from_file_location("qa",sys.argv[1]); p=importlib.util.module_from_spec(s); s.loader.exec_module(p); p.send_hotkey=lambda value:None; p.webbrowser.open=lambda *a,**k:True; p.launch_uri=lambda uri:None; p.bring_app_forward=lambda slug:None; p.app_installed=lambda scheme:scheme=="discord"; b=Backend(); p.SPOTIFY=p.SpotifyService(lambda:b); h=p.ThreadingHTTPServer(("127.0.0.1",0),p.Handler); print("PORT="+str(h.server_address[1]),flush=True); h.serve_forever()',
    path.join(temporary, 'server.py'), path.join(root, 'tests')], { windowsHide: true });
  let output = '', errors = '';
  python.stdout.on('data', chunk => { output += chunk; });
  python.stderr.on('data', chunk => { errors += chunk; });
  const port = await until(() => /PORT=(\d+)/.exec(output)?.[1], 'fixture server ' + errors);
  const base = 'http://127.0.0.1:' + port;
  console.log('Fixture ready');
  const profile = path.join(temporary, 'chrome');
  chrome = spawn(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-sandbox',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  const debugPort = await until(async () => (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0], 'Chrome');
  console.log('Chrome ready');
  const target = (await (await fetch('http://127.0.0.1:' + debugPort + '/json/list', { signal: AbortSignal.timeout(10000) })).json()).find(t => t.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome WebSocket timeout')), 10000);
    socket.onopen = () => { clearTimeout(timer); resolve(); }; socket.onerror = e => { clearTimeout(timer); reject(e); };
  });
  console.log('Browser connected');
  let serial = 0;
  const pending = new Map(), browserErrors = [];
  socket.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id) {
      const callback = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) callback.reject(new Error(JSON.stringify(msg.error))); else callback.resolve(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') browserErrors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
  };
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || expression);
    return result.result.value;
  }
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base + '/editor' });
  await until(() => evaluate('document.querySelectorAll(".designer-button").length === 3'), 'editor loaded');
  console.log('Editor loaded');
  assert.equal(await evaluate('document.querySelector(".advanced-controls").style.display'), 'none');
  // Make a folder, move an existing hotkey into it, and add another child.
  await evaluate('document.getElementById("add-folder").click()');
  await evaluate('document.querySelector("#button-controls input").value="Trabajo"; document.querySelector("#button-controls input").dispatchEvent(new Event("input",{bubbles:true}))');
  await evaluate('Array.prototype.filter.call(document.querySelectorAll("#button-controls button"),function(b){return b.textContent === "Abrir carpeta"})[0].click()');
  await evaluate('document.getElementById("add-button").click()');
  assert.equal(await evaluate('document.querySelectorAll(".designer-button").length'), 1);
  await evaluate('document.querySelector("#folder-navigation button").click()');
  // Select original mute by click (keyboard-accessible path).
  await evaluate('document.querySelector(".designer-button[data-id=mute]").click()');
  await evaluate('var locationSelect = Array.prototype.filter.call(document.querySelectorAll("#button-controls select"),function(s){return s.parentNode.firstChild.textContent === "Ubicación"})[0]; locationSelect.selectedIndex=1; locationSelect.dispatchEvent(new Event("change",{bubbles:true}))');
  assert.equal(await evaluate('document.querySelectorAll(".designer-button").length'), 2);
  // Icon-only keeps the accessible name, hides the text and persists in a folder.
  await evaluate('document.querySelector("#button-controls .segmented[aria-label^=Mostrar] [data-value=icon]").click()');
  await evaluate('document.querySelector(".icon-option[aria-label=Micrófono]").click()');
  assert.equal(await evaluate('!!document.querySelector(".designer-button[data-id=mute] .button-label")'), false);
  assert.equal(await evaluate('!!document.querySelector(".designer-button[data-id=mute] svg")'), true);
  assert.equal(await evaluate('document.querySelector(".designer-button[data-id=mute]").getAttribute("aria-label")'), 'Mutear Discord');
  await evaluate('document.getElementById("save").click()');
  await until(() => evaluate('document.getElementById("editor-message").textContent.indexOf("Cambios guardados")===0'), 'save');
  const token = await evaluate('localStorage.getItem("panel_token")');
  const config = await (await fetch(base + '/api/config', { headers: { 'X-Panel-Token': token } })).json();
  const folder = config.pages[0].buttons.find(b => b.type === 'folder');
  assert.equal(config.pages[0].buttons.find(b => b.id === 'mute').folderId, folder.id);
  assert.equal(config.pages[0].buttons.find(b => b.id === 'mute').builtinIcon, 'mic');
  assert.equal(config.pages[0].buttons.find(b => b.id === 'mute').displayMode, 'icon');
  // Return to the page and take desktop QA screenshot.
  await evaluate('document.querySelector("#folder-navigation button").click()');
  // Multi-cell sizing and switching modes must preserve legacy geometry.
  await evaluate('document.querySelector(".designer-button[data-id=deafen]").click()');
  await evaluate('var cols=document.getElementById("grid-cols");cols.value="2";cols.dispatchEvent(new Event("input",{bubbles:true}))');
  assert.ok(await evaluate('parseFloat(document.querySelector(".designer-button[data-id=deafen]").style.width) > 300'));
  async function mode(value) {
    await evaluate('document.querySelector("#page-controls .segmented[aria-label=Distribución] [data-value=' + value + ']").click()');
  }
  await mode('free');
  assert.equal(await evaluate('document.querySelector(".designer-button[data-id=deafen]").style.left'), '342px');
  assert.equal(await evaluate('document.querySelector(".designer-button[data-id=deafen]").style.width'), '300px');
  // Free layout: the top-left corner resizes while the bottom-right corner stays put (Alt = no magnet).
  const edges = 'var s=document.querySelector(".designer-button[data-id=deafen]").style;[parseFloat(s.left)+parseFloat(s.width),parseFloat(s.top)+parseFloat(s.height)]';
  const fixedCorner = await evaluate(edges);
  const tl = await evaluate('(function(){var r=document.querySelector(".designer-button[data-id=deafen] .resize-handle[data-handle=tl]").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: tl.x, y: tl.y, button: 'left', clickCount: 1, modifiers: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tl.x + 40, y: tl.y + 20, button: 'left', buttons: 1, modifiers: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tl.x + 40, y: tl.y + 20, button: 'left', clickCount: 1, modifiers: 1 });
  assert.ok(await evaluate('parseFloat(document.querySelector(".designer-button[data-id=deafen]").style.left) > 342'));
  assert.deepEqual(await evaluate(edges), fixedCorner);
  await mode('grid');
  await delay(600); // let the layout glide settle before measuring tile centers
  assert.ok(await evaluate('parseFloat(document.querySelector(".designer-button[data-id=deafen]").style.width) > 300'));
  // Actual pointer drag reorders grid items without changing their free positions.
  const drag = await evaluate('Array.prototype.map.call(document.querySelectorAll(".designer-button"),function(b){var r=b.getBoundingClientRect();return {id:b.getAttribute("data-id"),x:r.left+r.width/2,y:r.top+r.height/2}})');
  const from = drag.find(b => b.id === 'google'), to = drag.find(b => b.id === 'deafen');
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left', buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
  assert.equal(await evaluate('document.querySelector(".designer-button").getAttribute("data-id")'), 'google');
  // Dragging the grid corner handle one box to the right makes the tile 2 boxes wide.
  await delay(500);
  const grip = await evaluate('(function(){var h=document.querySelector(".designer-button[data-id=google] .resize-handle[data-handle=span-br]");var r=h.getBoundingClientRect();var s=document.getElementById("preview-shell").clientWidth/1024;return {x:r.left+r.width/2,y:r.top+r.height/2,step:(1024-48-80)/6*s+16*s}})()');
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: grip.x, y: grip.y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip.x + grip.step, y: grip.y + 4, button: 'left', buttons: 1 });
  assert.equal(await evaluate('document.querySelector(".span-badge").textContent'), '2 × 1');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grip.x + grip.step, y: grip.y + 4, button: 'left', clickCount: 1 });
  assert.equal(await evaluate('document.getElementById("grid-cols").value'), '2');
  assert.equal(await evaluate('!!document.querySelector(".span-badge")'), false);
  // Grid top-left corner: dragging it outward (left) adds a box too.
  await delay(500);
  const gripTL = await evaluate('(function(){var r=document.querySelector(".designer-button[data-id=google] .resize-handle[data-handle=span-tl]").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: gripTL.x, y: gripTL.y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gripTL.x - grip.step, y: gripTL.y - 4, button: 'left', buttons: 1 });
  assert.equal(await evaluate('document.querySelector(".span-badge").textContent'), '3 × 1');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gripTL.x - grip.step, y: gripTL.y - 4, button: 'left', clickCount: 1 });
  assert.equal(await evaluate('document.getElementById("grid-cols").value'), '3');
  await evaluate('document.getElementById("save").click()');
  await until(() => evaluate('document.getElementById("editor-message").textContent.indexOf("Cambios guardados")===0'), 'grid save');
  const artifactDir = path.join(root, '.cache'); await mkdir(artifactDir, { recursive: true });
  async function screenshot(name) {
    const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(artifactDir, name), Buffer.from(shot.data, 'base64'));
  }
  await screenshot('editor-desktop.png');
  // Reload from disk and verify the same folder persists.
  await cdp('Page.reload');
  await until(() => evaluate('document.querySelectorAll(".designer-button").length===3'), 'editor reload');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base + '/' });
  await until(() => evaluate('document.querySelectorAll("#pages button[data-id]").length===3'), 'iPad panel');
  await screenshot('panel-ipad.png');
  await evaluate('document.querySelector("button[data-id=' + folder.id + ']").click()');
  await until(() => evaluate('!!document.querySelector("#folder-overlay button[data-id=mute]")'), 'folder open');
  assert.equal(await evaluate('!!document.querySelector("#folder-overlay button[data-id=mute] .button-label")'), false);
  assert.equal(await evaluate('!!document.querySelector("#folder-overlay button[data-id=mute] svg")'), true);
  await evaluate('document.querySelector("#folder-overlay button[data-id=mute]").click()');
  await until(() => evaluate('document.querySelector("#folder-overlay button[data-id=mute]").className.indexOf("feedback-active") >= 0'), 'hotkey feedback');
  assert.equal(await evaluate('!!document.querySelector("#folder-overlay button[data-id=mute] .button-label")'), false);
  assert.ok(await evaluate('document.querySelector("#folder-overlay button[data-id=mute]").getAttribute("aria-label").indexOf("muteado")>=0'));
  await delay(2200); // allow normal polling to run
  assert.equal(await evaluate('document.querySelectorAll("#folder-overlay button[data-id]").length'), 2);
  await screenshot('folder-ipad.png');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{keyCode:27,bubbles:true}))');
  assert.equal(await evaluate('!!document.getElementById("folder-overlay")'), false);
  assert.equal(await evaluate('document.activeElement.getAttribute("data-id")'), folder.id);
  // Round-trip through real binary HTTP endpoints, including preview.
  const backup = await (await fetch(base + '/api/backup', { headers: { 'X-Panel-Token': token } })).arrayBuffer();
  const preview = await (await fetch(base + '/api/restore?preview=1', { method: 'POST', headers: { 'X-Panel-Token': token }, body: backup })).json();
  assert.equal(preview.folders, 1); assert.equal(preview.buttons, 4);
  const restored = await fetch(base + '/api/restore', { method: 'POST', headers: { 'X-Panel-Token': token }, body: backup });
  assert.equal(restored.status, 200);
  // Exercise the editor's actual file upload, summary and restore confirmation.
  const backupPath = path.join(temporary, 'transfer.zip');
  await writeFile(backupPath, Buffer.from(backup));
  await cdp('Page.navigate', { url: base + '/editor' });
  await until(() => evaluate('document.querySelectorAll(".designer-button").length===3'), 'editor import');
  const dom = await cdp('DOM.getDocument');
  const upload = await cdp('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#import-backup' });
  await cdp('DOM.setFileInputFiles', { nodeId: upload.nodeId, files: [backupPath] });
  await until(() => evaluate('!!document.querySelector("#restore-preview button.primary")'), 'import summary');
  assert.ok(await evaluate('document.getElementById("restore-preview").textContent.indexOf("1 carpetas") >= 0'));
  await evaluate('document.querySelector("#restore-preview button.primary").click()');
  await until(() => evaluate('document.getElementById("editor-message").textContent.indexOf("Personalización restaurada")===0'), 'UI restore');
  // Folder deletion defaults to retaining its children, then survives saving.
  await cdp('Page.navigate', { url: base + '/editor' });
  await until(() => evaluate('document.querySelectorAll(".designer-button").length===3'), 'editor for delete');
  await evaluate('document.querySelector(".designer-button[data-id=' + folder.id + ']").click()');
  await evaluate('Array.prototype.filter.call(document.querySelectorAll("#button-controls button"),function(b){return b.textContent === "Eliminar"})[0].click()');
  await evaluate('document.querySelector("#button-controls button").click()');
  assert.equal(await evaluate('document.querySelectorAll(".designer-button").length'), 4);
  await evaluate('document.getElementById("save").click()');
  await until(() => evaluate('document.getElementById("editor-message").textContent.indexOf("Cambios guardados")===0'), 'delete save');
  const afterDelete = await (await fetch(base + '/api/config', { headers: { 'X-Panel-Token': token } })).json();
  assert.ok(afterDelete.pages[0].buttons.every(b => !b.folderId && b.type === 'button'));
  // Also verify the explicit destructive choice removes only that folder's content.
  await evaluate('document.getElementById("add-folder").click()');
  await evaluate('Array.prototype.filter.call(document.querySelectorAll("#button-controls button"),function(b){return b.textContent === "Abrir carpeta"})[0].click()');
  await evaluate('document.getElementById("add-button").click()');
  await evaluate('document.querySelector("#folder-navigation button").click()');
  await evaluate('var tiles=document.querySelectorAll(".designer-button");tiles[tiles.length-1].click()');
  await evaluate('Array.prototype.filter.call(document.querySelectorAll("#button-controls button"),function(b){return b.textContent === "Eliminar"})[0].click()');
  await evaluate('window.confirm=function(){return true};Array.prototype.filter.call(document.querySelectorAll("#button-controls button"),function(b){return b.textContent === "Eliminar carpeta y contenido"})[0].click()');
  assert.equal(await evaluate('document.querySelectorAll(".designer-button").length'), 4);
  // Adding then deleting the same folder returns to the saved model, so nothing is pending.
  assert.equal(await evaluate('document.getElementById("save").disabled'), true);
  // Undo brings the folder back; redo removes it again.
  await evaluate('document.getElementById("undo").click()');
  assert.equal(await evaluate('document.querySelectorAll(".designer-button").length'), 5);
  await evaluate('document.getElementById("redo").click()');
  assert.equal(await evaluate('document.querySelectorAll(".designer-button").length'), 4);
  assert.equal(await evaluate('document.getElementById("save").disabled'), true);
  // A real widget DOM (not a button wrapper), driven by the isolated Spotify backend.
  await evaluate('document.getElementById("add-spotify").click()');
  assert.equal(await evaluate('document.querySelectorAll(".spotify-card").length'), 1);
  assert.equal(await evaluate('document.querySelector(".spotify-card").tagName'), 'DIV');
  assert.equal(await evaluate('document.querySelector(".spotify-card .spotify-control").disabled'), true);
  await evaluate('document.getElementById("save").click()');
  await until(() => evaluate('document.getElementById("editor-message").textContent.indexOf("Cambios guardados")===0'), 'Spotify card save');
  await screenshot('spotify-editor.png');
  await cdp('Page.navigate', { url: base + '/' });
  await until(() => evaluate('!!document.querySelector(".spotify-card .spotify-playpause:not(:disabled)")'), 'Spotify state');
  await until(() => evaluate('document.querySelector(".spotify-art").naturalWidth > 0'), 'authenticated artwork');
  assert.equal(await evaluate('document.querySelector(".spotify-title").textContent'), 'Canción de prueba');
  await evaluate('window.spotifyNode=document.querySelector(".spotify-card");window.spotifyProgress=document.querySelector(".spotify-progress-fill").style.width');
  await delay(2200);
  assert.equal(await evaluate('window.spotifyNode===document.querySelector(".spotify-card")'), true);
  await evaluate('document.querySelector(".spotify-playpause").click()');
  await until(() => evaluate('document.querySelector(".spotify-playpause").getAttribute("aria-label")==="Reproducir"'), 'Spotify pause');
  // Play/pause state is shown by the button only: no brand label and no status line while healthy.
  assert.equal(await evaluate('!!document.querySelector(".spotify-brand")'), false);
  assert.equal(await evaluate('document.querySelector(".spotify-status").textContent'), '');
  await until(() => evaluate('!document.querySelector(".spotify-next").disabled'), 'Spotify command done');
  await evaluate('document.querySelector(".spotify-next").click()');
  await until(() => evaluate('document.querySelector(".spotify-title").textContent==="Otra canción"'), 'Spotify next');
  assert.equal(await evaluate('document.querySelectorAll("button button").length'), 0);
  await screenshot('spotify-ipad.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await delay(100);
  await screenshot('spotify-desktop.png');
  // A second page shows the floating page switcher; tapping a tab slides to that page.
  await cdp('Page.navigate', { url: base + '/editor' });
  await until(() => evaluate('document.querySelectorAll(".page-row").length===1'), 'editor pages');
  await evaluate('document.getElementById("add-page").click()');
  assert.equal(await evaluate('document.querySelectorAll(".page-row").length'), 2);
  // App library: search, pick YouTube, and the new button becomes a shortcut to youtube.com.
  await evaluate('document.getElementById("add-button").click()');
  await evaluate('var s=document.querySelector(".app-search");s.value="you";s.dispatchEvent(new Event("input",{bubbles:true}))');
  assert.equal(await evaluate('document.querySelectorAll(".app-option").length'), 1);
  await evaluate('document.querySelector(".app-option[data-app=youtube]").click()');
  assert.equal(await evaluate('document.querySelector(".inspector-names strong").textContent'), 'YouTube');
  assert.equal(await evaluate('!!document.querySelector(".designer-button.is-selected svg.app-icon")'), true);
  // Collapse all hides every section; expand all brings them back.
  await evaluate('document.querySelector(".collapse-all").click()');
  assert.equal(await evaluate('document.querySelectorAll("#button-controls .group.is-collapsed").length === document.querySelectorAll("#button-controls .group-toggle").length'), true);
  assert.equal(await evaluate('document.querySelector(".collapse-all").textContent'), 'Expandir todo');
  await evaluate('document.querySelector(".collapse-all").click()');
  assert.equal(await evaluate('document.querySelectorAll("#button-controls .group.is-collapsed").length'), 0);
  await evaluate('document.querySelector(".group-toggle[data-section=avanzado]").click()');
  await screenshot('apps-editor.png');
  // Discord is "installed" in this fixture: picking it makes the button open the desktop app.
  await evaluate('document.getElementById("add-button").click()');
  await evaluate('var s=document.querySelector(".app-search");s.value="disc";s.dispatchEvent(new Event("input",{bubbles:true}))');
  await evaluate('document.querySelector(".app-option[data-app=discord]").click()');
  assert.equal(await evaluate('document.querySelector(".segmented[aria-label=\'Al tocar\'] .selected").getAttribute("data-value")'), 'app');
  assert.ok(await evaluate('Array.prototype.some.call(document.querySelectorAll("#button-controls select option"),function(o){return o.selected && o.textContent==="Discord · instalada"})'));
  await evaluate('document.getElementById("save").click()');
  await until(() => evaluate('document.getElementById("editor-message").textContent.indexOf("Cambios guardados")===0'), 'page save');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base + '/' });
  await until(() => evaluate('document.querySelectorAll("#tabs .tab").length===2'), 'page tabs');
  await evaluate('document.querySelectorAll("#tabs .tab")[1].click()');
  await until(() => evaluate('document.querySelector(".page-title").textContent==="Nueva página" && !document.getElementById("page-track").style.transform'), 'tab page change');
  assert.equal(await evaluate('document.querySelectorAll("#tabs .tab")[1].className.indexOf("selected")>=0'), true);
  assert.equal(await evaluate('!!document.querySelector("#pages button[data-id] svg.app-icon")'), true);
  const savedApp = (await (await fetch(base + '/api/config', { headers: { 'X-Panel-Token': token } })).json()).pages[1].buttons[0];
  assert.equal(savedApp.builtinIcon, 'app:youtube');
  assert.equal(savedApp.value, 'https://www.youtube.com/');
  const savedDiscord = (await (await fetch(base + '/api/config', { headers: { 'X-Panel-Token': token } })).json()).pages[1].buttons[1];
  assert.deepEqual([savedDiscord.action, savedDiscord.value], ['app', 'discord']);
  await evaluate('document.querySelector("#pages button[data-id=' + savedDiscord.id + ']").click()');
  await until(() => evaluate('document.querySelector("#pages button[data-id=' + savedDiscord.id + ']").className.indexOf("did-fire")>=0'), 'desktop app action');
  await delay(500);
  await screenshot('tabs-ipad.png');
  // A short rightward flick returns to the first page; a tiny drag springs back.
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  async function swipe(fromX, toX, steps) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y: 420 }] });
    for (let i = 1; i <= steps; i++) {
      await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + (toX - fromX) * i / steps, y: 420 }] });
      await delay(8);
    }
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await swipe(400, 440, 4);
  await until(() => evaluate('!document.getElementById("page-track").style.transform'), 'spring back');
  assert.equal(await evaluate('document.querySelector(".page-title").textContent'), 'Nueva página');
  await swipe(200, 620, 8);
  await until(() => evaluate('document.querySelector(".page-title").textContent==="Inicio" && !document.getElementById("page-track").style.transform'), 'swipe to previous page');
  assert.equal(await evaluate('document.querySelectorAll("#tabs .tab")[0].className.indexOf("selected")>=0'), true);
  assert.deepEqual(browserErrors, []);
  console.log('Browser passed: editor, simplified controls, folder CRUD, save/reload, iPad panel, folder action/feedback/polling, Escape/focus and binary backup/restore. Screenshots in .cache/.');
  await cdp('Browser.close');
} finally {
  if (socket) socket.close();
  if (chrome && chrome.exitCode === null) chrome.kill();
  if (python && python.exitCode === null) python.kill();
  await delay(800);
  // Only delete the exact temporary directory created above, never workspace data.
  if (path.dirname(temporary) === path.resolve(tmpdir()) && path.basename(temporary).startsWith('panel-qa-')) {
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
