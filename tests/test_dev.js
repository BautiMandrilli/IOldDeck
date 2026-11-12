/* Run with node tests/test_dev.js. All server writes use an isolated fixture. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const nodemon = require('nodemon');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  // Browser behavior: wait for unsaved changes, recover after downtime, reload once clean.
  let tick, response = 'old', reloads = 0, dirty = false, token = 'fixture', message = '';
  function XHR() {
    this.open = () => {};
    this.setRequestHeader = () => {};
    this.send = () => {
      if (response === 'offline') { this.onerror(); return; }
      this.status = 200; this.responseText = JSON.stringify({ version: response }); this.onload();
    };
  }
  const context = {
    window: { panelDevVersion: 'old', panelHasUnsavedChanges: () => dirty, location: { reload: () => reloads++ } },
    document: { getElementById: () => ({ set textContent(text) { message = text; } }) },
    localStorage: { getItem: () => token }, XMLHttpRequest: XHR,
    setInterval: callback => { tick = callback; }
  };
  vm.runInNewContext(await fs.readFile(path.join(root, 'public/dev-reload.js'), 'utf8'), context);
  tick(); assert.equal(reloads, 0);
  response = 'offline'; tick(); assert.equal(reloads, 0);
  dirty = true; response = 'new'; tick(); assert.equal(reloads, 0); assert.match(message, /Guardá/);
  dirty = false; tick(); assert.equal(reloads, 1);
  token = ''; tick(); assert.equal(reloads, 1);

  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'panel-dev-test-'));
  let log = '';
  async function until(fn, label) {
    for (let i = 0; i < 150; i++) {
      if (await fn()) return;
      await delay(100);
    }
    throw new Error('Timeout: ' + label + '\n' + log);
  }
  try {
    let source = await fs.readFile(path.join(root, 'server.py'), 'utf8');
    source = source.replace('PORT = 8765', 'PORT = 0').replace('    print("Editor en la PC:', '    PORT = server.server_address[1]\n    print("Editor en la PC:');
    await fs.writeFile(path.join(fixture, 'server.py'), source);
    await fs.copyFile(path.join(root, 'spotify_bridge.py'), path.join(fixture, 'spotify_bridge.py'));
    await fs.cp(path.join(root, 'public'), path.join(fixture, 'public'), { recursive: true });
    await fs.copyFile(path.join(root, 'nodemon.json'), path.join(fixture, 'nodemon.json'));
    nodemon({ cwd: fixture, configFile: path.join(fixture, 'nodemon.json'), watch: [path.join(fixture, 'server.py'), path.join(fixture, 'public')], stdout: false })
      .on('log', info => { if (info.type === 'error') log += info.message + '\n'; })
      .on('readable', function () {
        this.stdout.on('data', chunk => { log += chunk; });
        this.stderr.on('data', chunk => { log += chunk; });
      });
    const ports = () => [...log.matchAll(/Editor en la PC: http:\/\/localhost:(\d+)/g)].map(m => m[1]);
    await until(() => ports().length >= 1, 'first start');
    const token = (await fs.readFile(path.join(fixture, 'data/token.txt'), 'ascii')).trim();
    const headers = { 'X-Panel-Token': token };
    const endpoint = port => 'http://127.0.0.1:' + port;
    const first = await (await fetch(endpoint(ports()[0]) + '/api/dev-version', { headers })).json();
    assert.ok(first.version);
    const html = await (await fetch(endpoint(ports()[0]) + '/editor')).text();
    assert.ok(html.includes('/dev-reload.js') && html.includes(first.version));
    assert.equal((await fetch(endpoint(ports()[0]) + '/api/dev-version')).status, 401);
    await delay(700);
    await fs.writeFile(path.join(fixture, 'data/ignore-test.json'), '{}');
    await delay(1100);
    assert.equal(ports().length, 1, 'data must not restart Python');
    await fs.appendFile(path.join(fixture, 'public/style.css'), '\n/* restart fixture */\n');
    await until(() => ports().length >= 2, 'CSS-triggered restart');
    const second = await (await fetch(endpoint(ports()[1]) + '/api/dev-version', { headers })).json();
    assert.ok(second.version && second.version !== first.version);
    assert.equal((await fs.readFile(path.join(fixture, 'data/token.txt'), 'ascii')).trim(), token);
    console.log('Development checks passed: real nodemon restart, ignored data, persistent token, reload injection, authenticated revision and unsaved-change protection.');
  } catch (error) {
    console.error(error.message);
    throw error;
  } finally {
    await new Promise(resolve => nodemon.reset(resolve));
    process.chdir(root);
    // Delete only the exact temporary fixture created above.
    if (path.dirname(fixture) === path.resolve(os.tmpdir()) && path.basename(fixture).startsWith('panel-dev-test-')) {
      try { await fs.rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
      catch (error) { if (error.code !== 'EBUSY') throw error; }
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
