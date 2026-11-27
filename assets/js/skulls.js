(() => {
  const cv = document.getElementById('skullLayer');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  let W = 700, H = 800, skulls = [];
  const GLYPH = ['☠', '☠', '☠', '☠', '⚙'];
  const ri = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

  function build() {
    const n = matchMedia('(prefers-reduced-motion: reduce)').matches ? 12 : 28;
    skulls = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H, s: 11 + Math.random() * 21,
      v: .28 + Math.random() * 1.17, a: .05 + Math.random() * .23,
      d: Math.random() * .5 - .25, ph: Math.random() * 6.28, g: GLYPH[ri(0, 4)]
    }));
  }
  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    W = Math.max(320, r.width); H = Math.max(400, r.height);
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!skulls.length) build();
  }
  let lt = 0;
  function frame(t) {
    const dt = Math.min(50, t - lt || 16); lt = t;
    ctx.clearRect(0, 0, W, H);
    for (const k of skulls) {
      k.y += k.v * dt * .06; k.ph += dt * .001; k.x += Math.sin(k.ph) * k.d;
      if (k.y > H + 40) { k.y = -30; k.x = Math.random() * W; }
      ctx.font = k.s + 'px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,229,255,.85)'; ctx.shadowBlur = 9;
      ctx.fillStyle = 'rgba(120,225,255,' + k.a + ')';
      ctx.fillText(k.g, k.x, k.y);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  new ResizeObserver(resize).observe(cv.parentElement);
  resize();
})();
