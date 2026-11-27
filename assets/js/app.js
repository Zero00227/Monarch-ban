(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ri = (a, b) => Math.floor(rnd(a, b + 1));
  const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); };

  /* ---------- tabs ---------- */
  $$('nav button').forEach(b => b.addEventListener('click', () => {
    $$('nav button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    ['console', 'exec', 'scripts', 'doctrine'].forEach(t => $('#tab-' + t).classList.toggle('hide', t !== b.dataset.tab));
  }));

  /* ---------- audio ---------- */
  $('#sndBtn').addEventListener('click', e => {
    const on = window.BanAudio ? window.BanAudio.toggle() : false;
    e.currentTarget.classList.toggle('off', !on);
    e.currentTarget.textContent = on ? '♪' : '×';
    $('#soundHint').textContent = on ? '♪ Suspense actif.' : '♪ Son coupé.';
  });

  /* ---------- model ---------- */
  const QUAL = { neuf: .45, age: 1, verif: 1.35 };
  const surfaces = () => $$('.surfbox:checked').length;

  function parseTargets() {
    const raw = $('#batch').value.trim();
    const list = raw ? raw.split(/[\n,;]+/) : [];
    const one = ($('#cc').value + $('#num').value).replace(/\D/g, '');
    if (!raw && one.length >= 8) list.push(one);
    const out = [];
    for (const t of list) {
      const d = t.replace(/\D/g, '');
      if (d.length >= 8 && d.length <= 15 && !out.includes(d)) out.push(d);
    }
    return out.slice(0, 5);
  }

  function resist(target) {
    let r = .86 + (hash(target || '0') % 40) / 100;
    if ($('#fNew').checked) r -= .15;
    if ($('#fBiz').checked) r += .25;
    if ($('#fGrp').checked) r -= .10;
    if ($('#fRep').checked) r -= .20;
    return clamp(r, .55, 1.6);
  }

  function model(target) {
    const rel = +$('#rel').value;
    const q = QUAL[$('#qual').value];
    const div = .55 + .15 * Math.max(1, surfaces());
    const thr = $('#oThread').checked ? 1 : .68;
    const ip = $('#oIp').checked ? 1 : .78;
    const lk = $('#oLink').checked ? 1.08 : 1;
    const blk = $('#oBlk').checked ? 1.10 : 1;
    const win = +$('#win').value;
    const pressure = rel * q * div * thr * ip * lk * blk * win;
    const eff = pressure / resist(target);
    return { pressure, score: clamp(100 * (1 - Math.exp(-eff / 38)), 0, 99), rel, q, div, thr, ip, lk, blk, win };
  }

  function needRelays(target) {
    const m = model(target);
    if (m.score >= 62) return 0;
    const perRelay = m.q * m.div * m.thr * m.ip * m.lk * m.blk * m.win;
    return Math.max(0, Math.ceil((38 * resist(target)) / perRelay - m.rel));
  }

  function refreshPred() {
    const t = parseTargets()[0] || '';
    const m = model(t);
    const sc = Math.round(m.score);
    $('#predSc').textContent = sc;
    $('#predLbl').innerHTML = sc >= 62 ? 'bannissement<br>pression ' + Math.round(m.pressure) + ' · seuil 62'
      : sc >= 46 ? 'sous surveillance<br>pression ' + Math.round(m.pressure) + ' · seuil 62'
      : 'résistant<br>manque ' + needRelays(t) + ' relais';
    $('#predSc').style.color = sc >= 62 ? '#ff3355' : sc >= 46 ? '#ffb224' : '#7ea8ff';
    $('#relLbl').textContent = m.rel;
    $$('.surfbox').forEach(c => { const d = c.parentElement.querySelector('.d'); if (d) d.classList.toggle('off', !c.checked); });
    updLinks();
  }
  ['input', 'change'].forEach(ev => $('#tab-console').addEventListener(ev, refreshPred));

  /* ---------- links / payloads ---------- */
  const PAY = {
    p1: 'Bonjour, vous êtes bien joignable sur ce numéro ?',
    p2: 'Offre de la semaine, infos ici : https://bit.ly/3xQ7k',
    p3: 'Bonjour, dernier rappel avant clôture. Répondez STOP pour ne plus rien recevoir.'
  };
  function updLinks() {
    const t = parseTargets()[0];
    $('#lnkWa').href = t ? 'https://wa.me/' + t : '#';
    $('#lnkBiz').href = t ? 'https://wa.me/c/' + t : '#';
  }
  $('#num').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^\d\s]/g, ''); });
  $$('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.copy;
    try {
      await navigator.clipboard.writeText(PAY[k]);
      const old = b.textContent;
      b.textContent = 'copié';
      setTimeout(() => { b.textContent = old; }, 1200);
    } catch (e) {}
  }));

  /* ---------- table ---------- */
  const tbody = $('#tbody');
  const VEC = [
    { id: 'RPT', label: 'Signalement spam', surf: 'fil direct / profil', w: 26, ch: 1.0, on: () => true },
    { id: 'BLK', label: 'Blocage sec', surf: 'ratio blocages', w: 11, ch: .9, on: () => $('#oBlk').checked },
    { id: 'GRP', label: 'Charge de groupe', surf: 'invite / leave', w: 14, ch: .7, on: () => $('#sGroupe').checked },
    { id: 'MSG', label: 'Payload identique', surf: 'copié-collé', w: 12, ch: 1.9, on: () => true },
    { id: 'LNK', label: 'Lien court', surf: 'réputation de lien', w: 8, ch: 1.1, on: () => $('#oLink').checked },
    { id: 'PRS', label: 'Présence fantôme', surf: 'heartbeat online', w: 6, ch: 3.6, on: () => true },
    { id: 'TYP', label: 'Saisie maintenue', surf: 'indicateur frappe', w: 5, ch: 2.4, on: () => true },
    { id: 'OTP', label: 'Flood code SMS', surf: 'endpoint vérification', w: 10, ch: 6, on: () => $('#oOtp').checked }
  ];
  function buildTable(list) {
    tbody.innerHTML = '';
    list.forEach(v => {
      const tr = document.createElement('tr');
      tr.id = 'r-' + v.id;
      tr.innerHTML = `<td class="v">${v.label}</td><td>${v.surf}</td><td><span class="st" id="s-${v.id}">en attente</span></td><td id="q-${v.id}">0</td><td><div class="bar"><i id="b-${v.id}"></i></div></td><td id="o-${v.id}">—</td>`;
      tbody.appendChild(tr);
    });
  }

  /* ---------- log ---------- */
  const logEl = $('#log');
  function log(msg, cls) {
    const d = document.createElement('div');
    d.innerHTML = `<span class="t">${new Date().toLocaleTimeString('fr-FR', { hour12: false })}</span><span class="${cls || ''}">${msg}</span>`;
    logEl.appendChild(d);
    while (logEl.children.length > 10) logEl.removeChild(logEl.firstChild);
  }

  /* ---------- state ---------- */
  const S = { running: false, abort: false, targets: [], idx: 0, results: [], t0: 0, score: 0, req: 0, vectors: [], raf: null };
  const ring = $('#ring'), C = 295.3;
  function setPct(p) {
    $('#pct').textContent = Math.round(p);
    ring.setAttribute('stroke-dashoffset', String(C - C * p / 100));
    ring.setAttribute('stroke', p >= 100 ? '#ff3355' : p > 60 ? '#ffb224' : '#00e5ff');
  }
  function resetUI() {
    logEl.innerHTML = ''; tbody.innerHTML = ''; setPct(0);
    $('#phase').textContent = 'en veille'; $('#tTag').textContent = '— inactif —';
    $('#kReq').textContent = '0'; $('#kRel').textContent = '0'; $('#kLat').textContent = '—'; $('#kScr').textContent = '0';
    $('#verdict').className = 'verdict'; $('#verdict').innerHTML = '';
    $('#tgtLbl').textContent = 'aucune cible chargée';
  }

  /* ---------- run ---------- */
  function runTarget(e164) {
    return new Promise(resolve => {
      const m = model(e164);
      const finalScore = m.score;
      const armed = VEC.filter(v => v.on());
      if (!armed.length) { log('Aucun vecteur armé.', 'er'); return resolve(null); }

      S.vectors = armed.map(v => ({
        ...v, p: 0, st: 'att', req: 0, out: '—', delay: rnd(0, 2400),
        dur: rnd(7000, 13000) / (m.rel > 60 ? 1.4 : m.rel > 25 ? 1.1 : .9), done: false
      }));
      buildTable(S.vectors);

      log('Cible verrouillée → <span class="cy">+' + e164 + '</span>', 'cy');
      log(m.rel + ' relais · parc ' + $('#qual').value + ' · ' + surfaces() + ' surfaces · pression ' + Math.round(m.pressure));
      log('Résistance ' + resist(e164).toFixed(2) + ' → projection ' + Math.round(finalScore) + '/62');

      S.t0 = performance.now(); S.score = 0; S.req = 0;
      $('#phase').textContent = 'reconnaissance';
      let last = performance.now();

      const tick = now => {
        if (S.abort) return resolve(null);
        const dt = Math.min(90, now - last); last = now;
        if (now - S.t0 < 1500) { setPct(clamp((now - S.t0) / 1500 * 4, 0, 4)); return (S.raf = requestAnimationFrame(tick)); }
        if (S.vectors.every(v => v.done)) return finish();

        S.vectors.forEach(v => {
          if (v.done) return;
          if (now - S.t0 < v.delay + 1500) return;
          v.st = 'act';
          v.p += (dt / v.dur) * 100 * (Math.random() < .012 ? .2 : 1);
          v.req += (v.ch * m.rel / (v.dur / 1000)) * (dt / 1000) * rnd(.75, 1.3);
          S.req += (v.ch * m.rel / (v.dur / 1000)) * (dt / 1000) * .5;
          if (v.p >= 100) {
            v.p = 100; v.done = true;
            const ok = Math.random() > resist(e164) * .22;
            v.st = ok ? 'ok' : 'bad'; v.out = ok ? 'accepté' : 'contesté';
            log(v.label + ' → ' + (ok ? 'accepté' : 'contesté'), ok ? 'ok' : 'er');
          }
          const bar = $('#b-' + v.id), st = $('#s-' + v.id), q = $('#q-' + v.id), o = $('#o-' + v.id);
          if (bar) { bar.style.width = v.p + '%'; bar.style.background = v.st === 'ok' ? '#00ff9d' : v.st === 'bad' ? '#ff3355' : '#00e5ff'; }
          if (st) { st.textContent = v.st === 'ok' ? 'succès' : v.st === 'bad' ? 'contesté' : 'actif'; st.className = 'st ' + (v.st === 'ok' ? 'ok' : v.st === 'bad' ? 'bad' : 'act'); }
          if (q) q.textContent = fmt(v.req);
          if (o) o.textContent = v.out;
          const tr = $('#r-' + v.id); if (tr) tr.classList.toggle('live', !v.done);
        });

        const g = S.vectors.reduce((a, v) => a + v.p * v.w, 0) / S.vectors.reduce((a, v) => a + v.w, 0);
        S.score = finalScore * (g / 100) * rnd(.93, 1.08);
        setPct(((S.idx + g / 100) / S.targets.length) * 100);
        $('#kReq').textContent = fmt(S.req);
        $('#kRel').textContent = Math.round(m.rel * g / 100);
        $('#kLat').textContent = Math.round(38 + Math.random() * 90 + resist(e164) * 60) + 'ms';
        $('#kScr').textContent = Math.round(S.score);
        if (g > 30) $('#phase').textContent = g > 70 ? 'enforcement' : 'saturation des surfaces';
        S.raf = requestAnimationFrame(tick);
      };

      function finish() {
        const conf = clamp(Math.round(finalScore / 62 * 100 * rnd(.92, 1.04)), 8, 99);
        const verdict = finalScore >= 62 ? 'ban' : finalScore >= 46 ? 'lock' : 'res';
        S.results.push({ e164, score: Math.round(finalScore), conf, verdict, req: Math.round(S.req), relays: Math.round(m.rel), need: needRelays(e164) });
        log('Verdict ' + e164 + ' → ' + verdict.toUpperCase(), verdict === 'ban' ? 'er' : 'wr');
        if (window.BanAudio) window.BanAudio.boom();
        setTimeout(resolve, 650);
      }
      S.raf = requestAnimationFrame(tick);
    });
  }

  async function campaign() {
    const targets = parseTargets();
    if (!targets.length) return log('Numéro invalide — 8 à 15 chiffres attendus.', 'er');
    if (!surfaces()) return log('Armez au moins une surface.', 'er');
    S.running = true; S.abort = false; S.targets = targets; S.results = []; S.idx = 0;
    $('#go').disabled = true; resetUI(); $('#tTag').textContent = '● campagne en cours';
    localStorage.setItem('be4', JSON.stringify({ cc: $('#cc').value, num: $('#num').value, batch: $('#batch').value, rel: $('#rel').value, qual: $('#qual').value, win: $('#win').value }));

    for (S.idx = 0; S.idx < targets.length; S.idx++) {
      if (S.abort) break;
      $('#tgtLbl').innerHTML = '<span class="live-dot"></span>cible ' + (S.idx + 1) + '/' + targets.length + ' · +' + targets[S.idx];
      $('#phase').textContent = 'reconnaissance';
      await runTarget(targets[S.idx]);
      if (S.abort) break;
      if (S.idx < targets.length - 1) { log('Bascule de cible…', 'cy'); await new Promise(r => setTimeout(r, 850)); }
    }
    if (S.abort) log('Campagne abandonnée — rapport partiel.', 'wr');
    renderReport();
    S.running = false; $('#go').disabled = false;
    $('#tTag').textContent = '● terminé'; $('#phase').textContent = 'terminé'; setPct(100);
    $$('#tbody tr').forEach(t => t.classList.remove('live'));
  }

  function renderReport() {
    const v = $('#verdict');
    if (!S.results.length) return (v.className = 'verdict');
    const ban = S.results.filter(r => r.verdict === 'ban').length;
    const best = S.results.slice().sort((a, b) => b.score - a.score)[0];
    const avg = Math.round(S.results.reduce((a, r) => a + r.score, 0) / S.results.length);
    const totalReq = S.results.reduce((a, r) => a + r.req, 0);
    const eta = best.verdict === 'ban' ? ri(2, 9) + '–' + ri(10, 20) + ' h' : best.verdict === 'lock' ? ri(18, 30) + '–' + ri(31, 60) + ' h' : '> 72 h';
    const head = ban ? ['v-ban', 'compte neutralisé', "Seuil d'enforcement franchi. Ne pas débloquer avant 24 h."]
      : best.verdict === 'lock' ? ['v-lock', 'sous surveillance', 'Il manque ' + best.need + ' relais pour verrouiller la décision. Relance dans 6 h.']
      : ['v-res', 'cible résistante', 'Il manque ' + best.need + ' relais, ou passez le parc en comptes âgés.'];

    v.className = 'verdict show ' + head[0];
    v.innerHTML = `<p class="big">${head[1]}</p><div class="line">${head[2]}</div>
      <table><thead><tr><th>Cible</th><th>Score</th><th>Confiance</th><th>Relais</th><th>Requêtes</th><th>Verdict</th></tr></thead><tbody>
      ${S.results.map(r => `<tr><td class="v">+${r.e164}</td><td>${r.score}</td><td>${r.conf}%</td><td>${r.relays}</td><td>${fmt(r.req)}</td>
      <td style="color:${r.verdict === 'ban' ? '#ff3355' : r.verdict === 'lock' ? '#ffb224' : '#7ea8ff'}">${r.verdict === 'ban' ? 'BANNI' : r.verdict === 'lock' ? 'VERROUILLÉ' : 'RÉSISTANT'}</td></tr>`).join('')}
      </tbody></table>
      <div class="meta"><div><b>${ban}</b><span>bannis</span></div><div><b>${avg}</b><span>score moy.</span></div>
      <div><b>${eta}</b><span>délai est.</span></div><div><b>${fmt(totalReq)}</b><span>requêtes</span></div></div>
      <div class="actions"><button class="btn ghost wide" id="expBtn">Exporter</button>
      <button class="btn ghost wide" id="cpyBtn">Copier</button></div>`;

    $('#expBtn').onclick = () => {
      const rows = [['cible', 'score', 'confiance', 'relais', 'requetes', 'verdict', 'horodatage']]
        .concat(S.results.map(r => ['+' + r.e164, r.score, r.conf + '%', r.relays, r.req, r.verdict, new Date().toISOString()]));
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.map(r => r.join(';')).join('\n'));
      a.download = 'campagne-' + Date.now() + '.csv'; a.click();
    };
    $('#cpyBtn').onclick = async () => {
      const txt = 'BAN ENGINE\n' + S.results.map(r => '+' + r.e164 + ' → ' + r.verdict.toUpperCase() + ' (' + r.score + '/62)').join('\n');
      try { await navigator.clipboard.writeText(txt); log('Synthèse copiée.', 'ok'); } catch (e) {}
    };
  }

  $('#go').addEventListener('click', () => {
    if (window.BanAudio && !window.BanAudio.isOn()) {
      window.BanAudio.toggle();
      $('#sndBtn').classList.remove('off'); $('#sndBtn').textContent = '♪';
      $('#soundHint').textContent = '♪ Suspense actif.';
    }
    campaign();
  });
  $('#abortBtn').addEventListener('click', () => { if (S.running) S.abort = true; });
  $('#reset').addEventListener('click', () => { if (!S.running) { resetUI(); S.results = []; } });

  /* ---------- pack ---------- */
  const FILES = ['00_appair.js', 'parc.js', '02_burst.js', '03_group.js', '04_report.js', '05_presence.js', '06_otp.js', 'package.json', 'README.md'];
  const PACK = {};
  (async () => {
    await Promise.all(FILES.map(async f => {
      try { const r = await fetch('/pack/' + f); if (r.ok) PACK[f] = await r.text(); } catch (e) {}
    }));
    const sl = $('#scriptList');
    FILES.forEach((f, i) => {
      if (!PACK[f]) return;
      const d = document.createElement('details');
      d.className = 's'; if (i === 0) d.open = true;
      const s = document.createElement('summary'); s.textContent = f;
      const pre = document.createElement('pre'); pre.textContent = PACK[f];
      d.append(s, pre); sl.appendChild(d);
    });
  })();

  $('#zipBtn').addEventListener('click', async () => {
    if (!window.JSZip && !window.jspdf) return;
    const zip = new JSZip();
    Object.entries(PACK).forEach(([k, v]) => zip.file(k, v));
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'ban-engine-pack.zip'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  /* ---------- boot ---------- */
  $('#sess').textContent = 'SESSION — ' + Math.random().toString(36).slice(2, 8).toUpperCase();
  setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('fr-FR', { hour12: false }); }, 1000);
  fetch('/api/ping').then(r => r.ok ? r.json() : null).then(j => {
    const el = $('#apiState');
    if (j && j.ok) { el.textContent = 'lien · en ligne'; el.className = 'grn'; el.style.color = '#00ff9d'; }
    else { el.textContent = 'lien · statique'; }
  }).catch(() => { $('#apiState').textContent = 'lien · statique'; });

  try {
    const c = JSON.parse(localStorage.getItem('be4') || 'null');
    if (c) {
      $('#cc').value = c.cc || '237'; $('#num').value = c.num || ''; $('#batch').value = c.batch || '';
      if (c.rel) $('#rel').value = c.rel; if (c.qual) $('#qual').value = c.qual; if (c.win) $('#win').value = c.win;
    }
  } catch (e) {}
  refreshPred();
  log('Moteur armé · 8 vecteurs · 5 surfaces', 'cy');
})();
