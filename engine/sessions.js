'use strict'
const pino = require('pino')
const { Redis } = require('@upstash/redis')
const {
  default: makeWASocket, initAuthCreds, BufferJSON,
  Browsers, fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')

const redis = Redis.fromEnv()
const silent = pino({ level: 'silent' })

const revive = (v) => (v == null ? v : JSON.parse(JSON.stringify(v), BufferJSON.reviver))
const dead = (v) => JSON.stringify(v, BufferJSON.replacer)

async function redisAuthState(id) {
  const credKey = `wa:creds:${id}`
  const creds = revive(await redis.get(credKey)) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const raw = await Promise.all(ids.map((i) => redis.get(`wa:k:${id}:${type}:${i}`)))
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
                ? redis.del(`wa:k:${id}:${type}:${i}`)
                : redis.set(`wa:k:${id}:${type}:${i}`, dead(v)))
            }
          }
          await Promise.all(ops)
        }
      }
    },
    saveCreds: async () => { await redis.set(credKey, dead(creds)) }
  }
}

async function openSocket(id, phone) {
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
  return { sock, registered: state.creds.registered, phone }
}

module.exports = { redis, openSocket }
