'use strict'
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const config = require('./config')

async function verdict(manager, jid, exclude = []) {
  const clean = manager.online().filter((s) => !exclude.includes(s.label))
  const probe = clean[0] || manager.online()[0]
  if (!probe) return { result: 'inconnu', probe: null }

  await delay(config.detectDelayMs)

  let exists = null
  try {
    const r = await probe.sock.onWhatsApp(jid)
    exists = !!(r && r.length && r[0]?.exists)
  } catch { exists = null }

  let presence = null
  try {
    let got = false
    const fn = (u) => { if (u.id?.split('@')[0] === jid.split('@')[0]) got = true }
    probe.sock.ev.on('presence.update', fn)
    await probe.sock.presenceSubscribe(jid)
    for (let i = 0; i < 15 && !got; i++) await delay(200)
    probe.sock.ev.off('presence.update', fn)
    presence = got
  } catch { presence = false }

  let result = 'inconnu'
  if (exists === false) result = 'banni-probable'
  else if (exists === true && presence === true) result = 'toujours-actif'
  else if (exists === true && presence === false) result = 'degrade'
  else if (exists === null) result = 'inconnu'

  return { result, exists, presence, probe: probe.label }
}

module.exports = { verdict }
