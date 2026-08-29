// The transport bar (`opts.controls: true`). Plain HTML on top of the SVG pane — it owns
// no timing of its own: every button forwards to the controller that index.js builds, and
// the readout is pulled from controller.timeline() whenever the controller says something
// changed. The scrubber runs over the storyboard's CUMULATIVE timeline; index.js maps a
// position inside a `run.play` step to run.seek (§5.5).

const SCRUB_STEPS = 1000; // fixed range resolution: the total keeps changing under us

/**
 * createTransport(rootEl, controller) -> { update, destroy }
 *   controller = { play, pause, next, prev, seek(ms), speed(factor), timeline(), on(type,fn) }
 *   timeline() -> { total, time, label, index, steps, playing }
 * Returns an inert handle when there is no document (imports cleanly under Node).
 */
export function createTransport(rootEl, controller) {
  const doc = rootEl && rootEl.ownerDocument;
  if (!doc || typeof doc.createElement !== "function") return { update() {}, destroy() {} };

  const el = (tag, cls) => {
    const e = doc.createElement(tag);
    if (cls) e.setAttribute("class", cls);
    return e;
  };

  const bar = el("div", "smv-transport");
  const mkBtn = (act, glyph, title) => {
    const b = el("button", "smv-transport-btn");
    b.setAttribute("type", "button");
    b.setAttribute("data-act", act);
    b.setAttribute("title", title);
    b.textContent = glyph;
    bar.appendChild(b);
    return b;
  };
  const prevBtn = mkBtn("prev", "⏮", "previous step");
  const playBtn = mkBtn("play", "▶", "play");
  const nextBtn = mkBtn("next", "⏭", "next step");

  const scrub = el("input", "smv-transport-scrub");
  scrub.setAttribute("type", "range");
  scrub.setAttribute("min", "0");
  scrub.setAttribute("max", String(SCRUB_STEPS));
  scrub.setAttribute("step", "1");
  scrub.setAttribute("value", "0");
  scrub.value = "0";
  bar.appendChild(scrub);

  const speed = el("select", "smv-transport-speed");
  for (const f of [0.5, 1, 2, 4]) {
    const o = el("option");
    o.setAttribute("value", String(f));
    o.textContent = `${f}×`;
    if (f === 1) o.setAttribute("selected", "");
    speed.appendChild(o);
  }
  speed.value = "1";
  bar.appendChild(speed);

  const label = el("span", "smv-transport-label");
  bar.appendChild(label);
  rootEl.appendChild(bar);

  let scrubbing = false;
  let destroyed = false;

  function update() {
    if (destroyed) return;
    const tl = (controller.timeline && controller.timeline()) || {};
    const total = tl.total > 0 ? tl.total : 1;
    if (!scrubbing) {
      const v = String(Math.round(Math.max(0, Math.min(1, (tl.time || 0) / total)) * SCRUB_STEPS));
      if (scrub.value !== v) scrub.value = v;
      scrub.setAttribute("value", v);
    }
    const playing = !!tl.playing;
    playBtn.textContent = playing ? "⏸" : "▶";
    playBtn.setAttribute("data-playing", playing ? "" : "false");
    if (!playing) playBtn.removeAttribute("data-playing");
    const parts = [];
    if (tl.label != null) parts.push(String(tl.label));
    if (tl.steps) parts.push(`${Math.min(tl.index ?? 0, tl.steps)}/${tl.steps}`);
    const text = parts.join(" · ");
    if (label.textContent !== text) label.textContent = text;
  }

  const onClick = (ev) => {
    const act = ev && ev.currentTarget && ev.currentTarget.getAttribute("data-act");
    if (act === "play") {
      const tl = (controller.timeline && controller.timeline()) || {};
      if (tl.playing) controller.pause(); else controller.play();
    } else if (act === "next") controller.next();
    else if (act === "prev") controller.prev();
    update();
  };
  const onScrubStart = () => { scrubbing = true; };
  const onScrubInput = () => {
    const tl = (controller.timeline && controller.timeline()) || {};
    const total = tl.total > 0 ? tl.total : 1;
    controller.seek((Number(scrub.value) / SCRUB_STEPS) * total);
  };
  const onScrubEnd = () => { scrubbing = false; update(); };
  const onSpeed = () => { controller.speed(Number(speed.value) || 1); update(); };

  for (const b of [prevBtn, playBtn, nextBtn]) b.addEventListener("click", onClick);
  scrub.addEventListener("pointerdown", onScrubStart);
  scrub.addEventListener("input", onScrubInput);
  scrub.addEventListener("change", onScrubEnd);
  scrub.addEventListener("pointerup", onScrubEnd);
  speed.addEventListener("change", onSpeed);
  const offChange = controller.on ? controller.on("change", update) : null;

  update();

  return {
    el: bar,
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (typeof offChange === "function") offChange();
      for (const b of [prevBtn, playBtn, nextBtn]) b.removeEventListener("click", onClick);
      scrub.removeEventListener("pointerdown", onScrubStart);
      scrub.removeEventListener("input", onScrubInput);
      scrub.removeEventListener("change", onScrubEnd);
      scrub.removeEventListener("pointerup", onScrubEnd);
      speed.removeEventListener("change", onSpeed);
      bar.remove();
    },
  };
}

export default { createTransport };
