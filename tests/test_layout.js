/* Run with node tests/test_layout.js; no packages or browser required. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = {};
vm.runInNewContext(fs.readFileSync(require("node:path").join(__dirname, "../public/layout.js"), "utf8"), context);
const layout = context.PanelLayout.layout;
const buttons = Array.from({ length: 80 }, (_, i) => ({
  id: "b" + i, cols: (i % 6) + 1, rows: (i % 4) + 1,
  x: 30 + i, y: 50 + i, w: 100, h: 100, folderId: i > 75 ? "folder" : ""
}));
const page = { buttons, layout: "grid", height: 620 };
const original = JSON.stringify(page);
const result = layout(page, "");
assert.equal(result.items.length, 76);
assert.ok(result.height > 1400, "grid expands beyond the legacy free canvas limit");
const boxes = Object.values(result.boxes);
for (let i = 0; i < boxes.length; i++) {
  const a = boxes[i];
  assert.ok(a.x >= 24 && a.x + a.w <= 1000.001);
  assert.ok(a.y + a.h <= result.height - 23.99);
  for (let j = 0; j < i; j++) {
    const b = boxes[j];
    assert.ok(a.x + a.w <= b.x + .001 || b.x + b.w <= a.x + .001 || a.y + a.h <= b.y + .001 || b.y + b.h <= a.y + .001, "no overlapping cells");
  }
}
assert.equal(JSON.stringify(page), original, "layout never overwrites saved free positions");
page.layout = "free";
const free = layout(page, "");
assert.equal(free.boxes.b0.x, 30);
assert.equal(free.boxes.b0.w, 100);
const folder = layout(page, "folder");
assert.equal(folder.items.length, 4);
assert.equal(folder.grid, true, "folders use grid even on free pages");
assert.ok(folder.boxes.b76.w > 100);
console.log("Grid: spans, bounds, 80 items, folder filtering and preserved free positions passed.");
