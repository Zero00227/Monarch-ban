// 00_appair.js — appairer un relais
// node 00_appair.js <id>
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal'), pino = require('pino');

const id = process.argv[2] || '1';
const dir = path.join('./sessions', id);
fs.mkdirSync(dir, { recursive: true });

(async () => {
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }) });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection, qr }) => {
    if (qr) { qrcode.generate(qr, { small: true }); console.log('Scanne depuis le telephone du relais', id); }
    if (connection === 'open') console.log(`Relais ${id} appaire. Ctrl+C.`);
  });
})();
