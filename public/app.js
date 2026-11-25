'use strict'

/* ============ crânes qui tombent ============ */
;(function skulls() {
  const cv = document.getElementById('skulls')
  const cx = cv.getContext('2d')
  let w, h, items = []

  function size() {
    w = cv.width = innerWidth
    h = cv.height = innerHeight
  }
  function spawn(seed) {
    return {
      x: Math.random() * w,
      y: seed ? Math.random() * h : -40,
      s: 12 + Math.random() * 30,
      v: 0.25 + Math.random() * 0.85,
      a: 0.06 + Math.random() * 0.28,
      r: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.012
    }
  }
  function reset() {
    items = Array.from({ length: 44 }, () => spawn(true))
  }
  function loop() {
    cx.clearRect(0, 0, w, h)
    for (const it of items) {
      it.y += it.v
      it.r += it.vr
      it.x += Math.sin(it.y / 90) * 0.4
      if (it.y > h + 60) Object.assign(it, spawn(false))
      cx.save()
      cx.translate(it.x, it.y)
      cx.rotate(it.r)
      cx.font = `${it.s}px serif`
      cx.textAlign = 'center'
      cx.fillStyle = `rgba(0,208,255,${it.a})`
      cx.shadowColor = 'rgba(0,208,255,.8)'
      cx.shadowBlur = 12
      cx.fillText('☠', 0, 0)
      cx.restore()
    }
    requestAnimationFrame(loop)
  }
  size(); reset(); loop()
  addEventListener('resize', () => { size(); reset() })
})()

/* ============ musique de suspense procédurale ============ */
const Audio_ = (() => {
  let ctx = null, master = null, timers = [], on = false, built = false

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)

    // drone grave
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'; lp.frequency.value = 210; lp.Q.value = 7
    lp.connect(master)

    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 27.5
    const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 82.5; o3.detune.value = -12
    const g1 = ctx.createGain(); g1.gain.value = 0.22
    const g2 = ctx.createGain(); g2.gain.value = 0.30
    const g3 = ctx.createGain(); g3.gain.value = 0.07
    o1.connect(g1).connect(lp); o2.connect(g2).connect(lp); o3.connect(g3).connect(lp)
    ;[o1, o2, o3].forEach((o) => o.start())

    // LFO de tension
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.045
    const lg = ctx.createGain(); lg.gain.value = 90
    lfo.connect(lg).connect(lp.frequency); lfo.start()

    // souffle
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.35
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.8
    const ng = ctx.createGain(); ng.gain.value = 0.022
    noise.connect(bp).connect(ng).connect(master); noise.start()

    // battements de cœur
    timers.push(setInterval(() => {
      if (!on) return
      const t = ctx.currentTime
      ;[0, 0.22].forEach((off, i) => {
        const o = ctx.createOscillator(); o.type = 'sine'
        const g = ctx.createGain()
        o.frequency.setValueAtTime(58, t + off)
        o.frequency.exponentialRampToValueAtTime(26, t + off + 0.16)
        g.gain.setValueAtTime(0.0001, t + off)
        g.gain.exponentialRampToValueAtTime(i ? 0.20 : 0.32, t + off + 0.012)
        g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.24)
        o.connect(g).connect(master)
        o.start(t + off); o.stop(t + off + 0.3)
      })
    }, 1500))

    // cloche dissonante
    timers.push(setInterval(() => {
      if (!on) return
      const f = [932, 1108, 1244][(Math.random() * 3) | 0]
      const t = ctx.currentTime
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4)
      o.connect(g).connect(master)
      o.start(t); o.stop(t + 2.5)
    }, 7000 + Math.random() * 4000))

    built = true
  }

  function fade(v, t = 0.9) {
    if (!master) return
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime)
    master.gain.linearRampToValueAtTime(v, ctx.currentTime + t)
  }

  function toggle() {
    if (!built) build()
    ctx.resume()
    on = !on
    fade(on ? 0.16 : 0, 1.1)
    return on
  }

  return { toggle, get on() { return on }, kick: () => { if (built) ctx.resume() } }
})()

/* ============ DOM ============ */
const $ = (id) => document.getElementById(id)
const sessionsEl = $('sessions'), rowsEl = $('rows'), logEl = $('log'), verdictEl = $('verdict')
let currentJob = null

/* ============ musique : 1er geste ============ */
let audioOn = false
$('music').addEventListener('click', () => {
  audioOn = Audio_.toggle()
  $('music').textContent = `MUSIC: ${audioOn ? 'ON' : 'OFF'}`
  $('music').classList.toggle('ghost', !audioOn)
})
addEventListener('pointerdown', () => Audio_.kick(), { once: true })

/* ============ sliders ============ */
for (const [id, out, suf] of [['passes', 'passVal', ''], ['duration', 'durVal', 's'], ['pause', 'pauseVal', 's']]) {
  const el = $(id)
  const sync = () => { $(out).textContent = el.value + suf }
  el.addEventListener('input', sync); sync()
}

/* ============ rendu ============ */
function log(text, level = '') {
  const line = document.createElement('div')
  line.className = level
  line.textContent = `${new Date().toLocaleTimeString()}  ${text}`
  logEl.appendChild(line)
  logEl.scrollTop = logEl.scrollHeight
}

function renderSessions(list) {
  sessionsEl.innerHTML = ''
  if (!list.length) { sessionsEl.innerHTML = '<span class="dim">aucune session — appaire un numéro</span>'; return }
  for (const s of list) {
    const cls = s.ready ? 'online' : s.status === 'awaiting' ? 'awaiting' : 'dead'
    const d = document.createElement('div')
    d.className = `sess ${cls}`
    d.innerHTML = `<span>☠ ${s.label}</span><span>${s.status}</span>`
    const x = document.createElement('button')
    x.textContent = '✕'; x.title = 'fermer'
    x.onclick = () => fetch(`/api/session/${encodeURIComponent(s.label)}`, { method: 'DELETE' })
    d.appendChild(x)
    sessionsEl.appendChild(d)
  }
}

const VERDICT_LABEL = {
  'banni-probable': 'BAN PROBABLE',
  'toujours-actif': 'ACTIF',
  'degrade': 'DÉGRADÉ',
  'inconnu': 'INDÉTERMINÉ',
  'absent': 'ABSENT'
}

function renderRows(rows) {
  rowsEl.innerHTML = ''
  if (!rows.length) { rowsEl.innerHTML = '<tr><td colspan="6" class="empty">aucune attaque lancée</td></tr>'; return }
  for (const r of rows) {
    const tr = document.createElement('tr')
    const etat = r.status === 'pause' ? `PAUSE ${r.pauseLeft ?? ''}s` : r.status.toUpperCase()
    tr.innerHTML = `
      <td>${r.pass}</td>
      <td>${r.sessions || '—'}</td>
      <td>${r.durationSec ? r.durationSec + 's' : '—'}</td>
      <td>${r.ops || 0}</td>
      <td class="st-${r.status}">${etat}</td>
      <td>${r.verdict ? (VERDICT_LABEL[r.verdict] || r.verdict) : '—'}</td>`
    rowsEl.appendChild(tr)
  }
}

function renderJob(job) {
  currentJob = job
  renderRows(job.rows)
  verdictEl.className = 'verdict idle'
  if (job.status === 'running') { verdictEl.textContent = 'ATTAQUE EN COURS…'; verdictEl.className = 'verdict idle st-running' }
  if (job.status === 'stopped') verdictEl.textContent = 'STOPPÉ'
  if (job.status === 'error') verdictEl.textContent = `ERREUR — ${job.reason || ''}`
  if (job.status === 'done') {
    if (job.final === 'fucked') { verdictEl.textContent = `NUMBER FUCKED BY MONARCH — ${job.target}`; verdictEl.className = 'verdict fucked' }
    else if (job.final === 'absent') { verdictEl.textContent = `NUMBER ALREADY DEAD — ${job.target}`; verdictEl.className = 'verdict degrade' }
    else if (job.final === 'degrade') { verdictEl.textContent = `NUMBER DEGRADED — ${job.target}`; verdictEl.className = 'verdict degrade' }
    else { verdictEl.textContent = `NUMBER STILL ACTIVE — ${job.target}`; verdictEl.className = 'verdict active' }
  }
}

/* ============ SSE ============ */
async function poll() {
  try {
    const r = await fetch('/api/state')
    const s = await r.json()
    $('link').className = 'dot on'; $('link').textContent = 'LINKED'
    renderSessions(s.sessions)
    const code = s.sessions.find((x) => x.code)
    if (code) $('codeBox').textContent = `${code.label} → ${code.code}`
    if (s.job) renderJob(s.job)
  } catch {
    $('link').className = 'dot off'; $('link').textContent = 'OFFLINE'
  }
}
poll()
setInterval(poll, 1500)
/* ============ appairage ============ */
$('pairForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const label = $('pLabel').value.trim(), phone = $('pPhone').value.trim()
  if (!label || !phone) return
  $('codeBox').textContent = 'demande de code…'
  const r = await fetch('/api/session/pair', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, phone })
  })
  const j = await r.json()
  if (!r.ok) { $('codeBox').textContent = j.error; log(j.error, 'err') }
  else { $('pLabel').value = ''; $('pPhone').value = '' }
})

/* ============ attaque ============ */
$('attackForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  if (!audioOn) { $('music').click() }

  const body = {
    target: $('target').value.trim(),
    passes: Number($('passes').value),
    duration: Number($('duration').value),
    pause: Number($('pause').value),
    groupId: $('groupId').value.trim() || null,
    modules: [...document.querySelectorAll('.mods input:checked')].map((i) => i.value),
    sessions: [...document.querySelectorAll('.sess.online')].map((d) =>
      d.querySelector('span').textContent.replace('☠ ', '').trim())
  }

  const r = await fetch('/api/attack', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const j = await r.json()
  if (!r.ok) { log(j.error, 'err'); return }
  log(`attaque lancée sur ${body.target}`, 'warn')
})

$('stop').addEventListener('click', () => fetch('/api/stop', { method: 'POST' }))
