/* ES5 motion helpers shared by the iPad panel (Safari iOS 9) and the editor.
   Springs use Apple's designer parameters: damping ratio + response (seconds).
   They always continue from the live value and velocity, so they can be interrupted. */
(function (root) {
  "use strict";
  var raf = root.requestAnimationFrame || root.webkitRequestAnimationFrame ||
    function (fn) { return setTimeout(function () { fn(Date.now()); }, 16); };
  var caf = root.cancelAnimationFrame || root.webkitCancelAnimationFrame || clearTimeout;
  var lastTouch = 0;

  function reduced() {
    return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function transform(el, value) {
    el.style.webkitTransform = value;
    el.style.transform = value;
  }
  function transition(el, value) {
    el.style.webkitTransition = value.replace(/(^|, )transform/g, "$1-webkit-transform");
    el.style.transition = value;
  }

  function Spring(onUpdate) {
    this.value = 0; this.velocity = 0; this.target = 0;
    this.damping = 1; this.response = 0.4;
    this.onUpdate = onUpdate; this.onRest = null; this.frame = 0; this.last = 0;
  }
  Spring.prototype.stop = function () {
    if (this.frame) caf(this.frame);
    this.frame = 0;
  };
  Spring.prototype.set = function (value) {
    this.stop(); this.value = this.target = value; this.velocity = 0; this.onUpdate(value);
  };
  Spring.prototype.to = function (target, options) {
    var self = this;
    options = options || {};
    this.target = target;
    if (options.velocity != null) this.velocity = options.velocity;
    this.damping = options.damping == null ? 1 : options.damping;
    this.response = options.response || 0.4;
    this.onRest = options.onRest || null;
    if (reduced()) { this.settle(); return; }
    if (!this.frame) { this.last = 0; this.frame = raf(function (now) { self.tick(now); }); }
  };
  Spring.prototype.settle = function () {
    var done = this.onRest;
    this.stop(); this.value = this.target; this.velocity = 0; this.onRest = null;
    this.onUpdate(this.value);
    if (done) done();
  };
  Spring.prototype.tick = function (now) {
    var self = this;
    var dt = this.last ? Math.min(0.064, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    var stiffness = Math.pow(2 * Math.PI / this.response, 2);
    var friction = 4 * Math.PI * this.damping / this.response;
    var steps = Math.max(1, Math.ceil(dt * 240)), h = dt / steps;
    this.last = now;
    for (var i = 0; i < steps; i++) {
      this.velocity += (-stiffness * (this.value - this.target) - friction * this.velocity) * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.value - this.target) < 0.3 && Math.abs(this.velocity) < 6) { this.settle(); return; }
    this.onUpdate(this.value);
    this.frame = raf(function (t) { self.tick(t); });
  };

  // Keeps the last ~100 ms of positions so a release can hand its velocity to a spring.
  function Tracker() { this.samples = []; }
  Tracker.prototype.add = function (position) {
    var now = Date.now();
    this.samples.push([now, position]);
    while (this.samples.length > 2 && now - this.samples[0][0] > 100) this.samples.shift();
  };
  Tracker.prototype.velocity = function () {
    var s = this.samples;
    if (s.length < 2) return 0;
    var first = s[0], last = s[s.length - 1], dt = (last[0] - first[0]) / 1000;
    if (Date.now() - last[0] > 80 || dt <= 0) return 0;
    return (last[1] - first[1]) / dt;
  };

  // Where a flick would come to rest, using the same decay as scrolling.
  function project(velocity, rate) {
    rate = rate || 0.998;
    return velocity / 1000 * rate / (1 - rate);
  }
  // Progressive resistance past an edge instead of a hard stop.
  function rubberband(overshoot, dimension) {
    var c = 0.55;
    return overshoot * dimension * c / (dimension + c * Math.abs(overshoot));
  }

  // Highlight on touch-down, release when the finger leaves (10 px hysteresis) or lifts.
  function pressable(el) {
    var x = 0, y = 0, on = false;
    function down(px, py) {
      if (el.disabled) return;
      x = px; y = py; on = true; el.classList.add("is-pressed");
    }
    function up() { if (on) { on = false; el.classList.remove("is-pressed"); } }
    el.addEventListener("touchstart", function (e) {
      lastTouch = Date.now();
      if (e.touches.length === 1) down(e.touches[0].clientX, e.touches[0].clientY);
    }, false);
    el.addEventListener("touchmove", function (e) {
      var t = e.touches[0];
      if (on && Math.abs(t.clientX - x) + Math.abs(t.clientY - y) > 10) up();
    }, false);
    el.addEventListener("touchend", function () { lastTouch = Date.now(); up(); }, false);
    el.addEventListener("touchcancel", up, false);
    el.addEventListener("mousedown", function (e) {
      if (e.button === 0 && Date.now() - lastTouch > 700) down(e.clientX, e.clientY);
    }, false);
    el.addEventListener("mouseup", up, false);
    el.addEventListener("mouseleave", up, false);
  }

  // Briefly applies a class that runs a one-shot CSS animation.
  function flash(el, name, ms) {
    if (!el) return;
    el.classList.remove(name);
    void el.offsetWidth;
    el.classList.add(name);
    setTimeout(function () { el.classList.remove(name); }, ms || 600);
  }

  // FLIP: remember where [data-id] nodes were, then let rebuilt nodes glide from there.
  function measure(container) {
    var map = {}, nodes = container.querySelectorAll("[data-id]");
    for (var i = 0; i < nodes.length; i++) map[nodes[i].getAttribute("data-id")] = nodes[i].getBoundingClientRect();
    return map;
  }
  function glide(container, before, scale) {
    if (!before || reduced()) return;
    var nodes = container.querySelectorAll("[data-id]"), moved = [];
    scale = scale || 1;
    for (var i = 0; i < nodes.length; i++) {
      var old = before[nodes[i].getAttribute("data-id")];
      if (!old) continue;
      var now = nodes[i].getBoundingClientRect();
      var dx = (old.left - now.left) / scale, dy = (old.top - now.top) / scale;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      transition(nodes[i], "none");
      transform(nodes[i], "translate(" + dx + "px," + dy + "px)");
      moved.push(nodes[i]);
    }
    if (!moved.length) return;
    void container.offsetWidth;
    moved.forEach(function (el) {
      transition(el, "transform 420ms cubic-bezier(.2,.85,.25,1)");
      transform(el, "");
    });
    setTimeout(function () { moved.forEach(function (el) { transition(el, ""); }); }, 460);
  }

  root.Motion = {
    Spring: Spring, Tracker: Tracker, project: project, rubberband: rubberband,
    pressable: pressable, flash: flash, measure: measure, glide: glide,
    reduced: reduced, transform: transform, transition: transition
  };
}(this));
