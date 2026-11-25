'use strict'
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')
const pino = require('pino')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')
const config = require('./config')

const silent = pino({ level: 'silent' })
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const FINGERPRINTS = [
  () => Browsers.ubuntu('Chrome'),
  () => Browsers.macOS('Safari'),
  () => Browsers.windows('Firefox'),
  () => Browsers.ubuntu('Firefox'),
  () => Browsers.macOS('Chrome'),
  () => Browsers.windows('Edge'),
  () => Browsers.ubuntu('Brave')
]

class Session {
  constructor(label, mgr) {
    this.label = label
    this.mgr = mgr
    this.dir = path.join(config.sessionDir, label)
    this.sock = null
    this.status = 'idle'
    this.code = null
    this.phone = null
    this._asked = false
  }

  get ready() { return this.status === 'online' && this.sock }

  async open(phone = null) {
    fs.mkdirSync(this.dir, { recursive: true })
    if (phone) this.phone = String(phone).replace(/\D/g, '')

    const { state, saveCreds } = await useMultiFileAuthState(this.dir)
    const { version } = await fetchLatestBaileysVersion().catch(() => ({}))

    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      printQRInTerminal: false,
      browser: FINGERPRINTS[(Math.random() * FINGERPRINTS.length) | 0](),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      shouldSyncHistoryMessage: () => false,
      getMessage: async () => undefined,
      logger: silent,
      ...(config.agent ? { options: { agent: config.agent() } } : {})
    })

    this.sock = sock
    this.status = 'pairing'
    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u

      if (qr && !state.creds.registered && this.phone && !this._asked) {
        this._asked = true
        await delay(1500)
        try {
          const raw = await sock.requestPairingCode(this.phone)
          this.code = String(raw).match(/.{1,4}/g)?.join('-') ?? raw
          this.status = 'awaiting'
          this.mgr.emit('code', this)
        } catch (e) {
          this._asked = false
          this.mgr.emit('err', this, e.message)
        }
      }

      if (connection === 'open') {
        this.status = 'online'
        this.mgr.emit('change', this)
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode
        if (code === DisconnectReason.loggedOut) {
          this.status = 'logged-out'
          this.mgr.emit('change', this)
        } else if (
          code === DisconnectReason.restartRequired ||
          code === DisconnectReason.connectionLost ||
          code === DisconnectReason.timedOut ||
          code === DisconnectReason.connectionClosed
        ) {
          this.status = 'reconnecting'
          this.mgr.emit('change', this)
          await delay(2000)
          this.open(this.phone).catch(() => {})
        } else {
          this.status = 'closed'
          this.mgr.emit('change', this)
        }
      }
    })
  }

  close() {
    try { this.sock?.end(undefined) } catch {}
    this.sock = null
    this.status = 'closed'
  }
}

class Manager extends EventEmitter {
  constructor() {
    super()
    this.map = new Map()
    fs.mkdirSync(config.sessionDir, { recursive: true })
  }

  get(label) { return this.map.get(label) }

  async pair(label, phone) {
    if (this.map.has(label)) this.map.get(label).close()
    const s = new Session(label, this)
    this.map.set(label, s)
    this.emit('change', s)
    await s.open(phone)
    return s
  }

  async restoreAll() {
    const dirs = fs.readdirSync(config.sessionDir, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name)
    for (const label of dirs) {
      const s = new Session(label, this)
      this.map.set(label, s)
      s.open().catch(() => {})
      await delay(1500)
    }
    return dirs.length
  }

  online() { return [...this.map.values()].filter((s) => s.ready) }
  all() { return [...this.map.values()] }
  kill(label) {
    const s = this.map.get(label)
    if (!s) return false
    s.close(); this.map.delete(label); this.emit('change', s)
    return true
  }
  killAll() { for (const s of this.map.values()) s.close(); this.map.clear() }
}

module.exports = new Manager()
