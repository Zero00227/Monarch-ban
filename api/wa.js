'use strict'
const pino = require('pino')
const {
  default: makeWASocket, initAuthCreds, BufferJSON,
  Browsers, fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')

const silent = pino({ level: 'silent' })

/* Redis initialisé à la demande : un import ne doit jamais tuer la fonction */
let _redis = null
function db() {
  if (_redis) return _redis
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error('UPSTASH_REDIS_REST_URL / _TOKEN absents')
  }
  const { Redis } = require('@upstash/redis')
  _redis = Redis.fromEnv()
  return _redis
}

const revive = (v) => (v == null ? v : JSON.parse(JSON.stringify(v), BufferJSON.reviver))
const dead = (v) => JSON.stringify(v, BufferJSON.replacer)

async function redisAuthState(id) {
  const r = db()
  const credKey = `wa:creds:${id}`
  const creds = revive(await r.get(credKey)) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const raw = await Promise.all(ids.map((i) => r.get(`wa:k:${id}:${type}:${i}`)))
          const out = {}
          ids.forEach((i, n) => { if (raw[n] != null) out[i] = revive(raw[n]) })
          return out
        },
        set: async (data) => {
          const ops = []
          for (const type of Object.keys(data)) {
            for (const i of Object.keys(data[type])) {
              const v = data[type][i]
              ops.push(v == null
                ? r.del(`wa:k:${id}:${type}:${i}`)
                : r.set(`wa:k:${id}:${type}:${i}`, dead(v)))
            }
          }
          await Promise.all(ops)
        }
      }
    },
    saveCreds: async () => { await r.set(credKey, dead(creds)) }
  }
}

async function openSocket(id) {
  const { state, saveCreds } = await redisAuthState(id)
  const { version } = await fetchLatestBaileysVersion().catch(() => ({}))

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    shouldSyncHistoryMessage: () => false,
    getMessage: async () => undefined,
    logger: silent
  })

  sock.ev.on('creds.update', saveCreds)
  return { sock, registered: state.creds.registered }
}

module.exports = { db, openSocket }
