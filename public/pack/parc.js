// parc.js — parc de sessions relais
const fs = require('fs'), path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal'), pino = require('pino');

const DIR = './sessions';
const jidOf = n => n.replace(/\D/g, '') + '@s.whatsapp.net';

async function ouvrir(id) {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(DIR, id));
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['BanEngine', 'Chrome', '120.0.0']
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'open') console.log(`[${id}] connecte`);
    if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
      console.log(`[${id}] reconnexion`);
      setTimeout(() => ouvrir(id), 2500);
    }
  });
  await delay(1200);
  return sock;
}

async function chargerParc(max = Infinity) {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const ids = fs.readdirSync(DIR).filter(d => fs.statSync(path.join(DIR, d)).isDirectory()).slice(0, max);
  const parc = [];
  for (const id of ids) parc.push({ id, sock: await ouvrir(id) });
  console.log(`${parc.length} sessions chargees`);
  return parc;
}

module.exports = { chargerParc, jidOf, delay };
