(() => {
  const A = { ctx: null, master: null, on: false, timers: [], nodes: [] };
  const ri = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

  function start() {
    if (A.ctx || !A.on) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC(); A.ctx = ac;
    const master = ac.createGain(); master.gain.value = 0;
    master.connect(ac.destination); A.master = master;
    master.gain.linearRampToValueAtTime(.5, ac.currentTime + 3);

    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 6;
    const dg = ac.createGain(); dg.gain.value = .2; lp.connect(dg); dg.connect(master);
    [55, 55.6, 82.4].forEach((f, i) => {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.detune.value = i * 7 - 7; o.connect(lp); o.start(); A.nodes.push(o);
    });
    const lfo = ac.createOscillator(); lfo.frequency.value = .055;
    const lg = ac.createGain(); lg.gain.value = 110;
    lfo.connect(lg); lg.connect(lp.frequency); lfo.start(); A.nodes.push(lfo);

    const sub = ac.createOscillator(); sub.type = 'sine'; sub.frequency.value = 27.5;
    const sg = ac.createGain(); sg.gain.value = .3; sub.connect(sg); sg.connect(master); sub.start(); A.nodes.push(sub);

    const beat = () => {
      if (!A.on || !A.ctx) return;
      [0, .42].forEach(off => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(64, ac.currentTime + off);
        o.frequency.exponentialRampToValueAtTime(31, ac.currentTime + off + .16);
        g.gain.setValueAtTime(0, ac.currentTime + off);
        g.gain.linearRampToValueAtTime(.34, ac.currentTime + off + .012);
        g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + off + .3);
        o.connect(g); g.connect(master); o.start(ac.currentTime + off); o.stop(ac.currentTime + off + .34);
      });
    };
    beat(); A.timers.push(setInterval(beat, 2100));

    const bell = () => {
      if (!A.on || !A.ctx) return;
      const f = [196, 233, 261.6, 311, 392, 466][ri(0, 5)];
      [0, .5].forEach(det => {
        const o = ac.createOscillator(), g = ac.createGain(), dl = ac.createDelay();
        o.type = 'triangle'; o.frequency.value = f; o.detune.value = det * 9;
        dl.delayTime.value = .34;
        g.gain.setValueAtTime(0, ac.currentTime);
        g.gain.linearRampToValueAtTime(.09, ac.currentTime + .02);
        g.gain.exponentialRampToValueAtTime(.0008, ac.currentTime + 4.5);
        o.connect(g); g.connect(dl); dl.connect(master); g.connect(master);
        o.start(); o.stop(ac.currentTime + 4.7);
      });
      A.timers.push(setTimeout(bell, 3200 + Math.random() * 4000));
    };
    setTimeout(bell, 1500);
  }

  function stop() {
    A.timers.forEach(t => { clearTimeout(t); clearInterval(t); }); A.timers = [];
    if (A.ctx) { A.nodes.forEach(n => { try { n.stop(); } catch (e) {} }); A.ctx.close(); }
    A.ctx = null;
  }

  window.BanAudio = {
    isOn: () => A.on,
    toggle() { A.on = !A.on; if (A.on) start(); else stop(); return A.on; },
    boom() {
      if (!A.ctx || !A.on) return;
      const ac = A.ctx, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(120, ac.currentTime);
      o.frequency.exponentialRampToValueAtTime(28, ac.currentTime + 1.4);
      g.gain.setValueAtTime(.55, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + 1.6);
      o.connect(g); g.connect(A.master); o.start(); o.stop(ac.currentTime + 1.7);
    }
  };
})();
