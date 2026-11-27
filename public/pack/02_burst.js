// 02_burst.js — rafale sortante + payloads
// CIBLE=2376XXXXXXXX RELAIS=25 node 02_burst.js
const { chargerParc, jidOf, delay } = require('./parc');

const J = jidOf(process.env.CIBLE);
const PAYLOADS = [
  'Bonjour, vous etes bien joignable sur ce numero ?',
  'Offre de la semaine, infos ici : https://bit.ly/3xQ7k',
  'Bonjour, dernier rappel avant cloture. Repondez STOP pour ne plus rien recevoir.'
];

(async () => {
  const parc = await chargerParc(Number(process.env.RELAIS) || 20);
  for (const { id, sock } of parc) {
    try {
      await sock.presenceSubscribe(J);
      await sock.sendPresenceUpdate('composing', J);
      await delay(1500 + Math.random() * 3000);
      await sock.sendMessage(J, { text: PAYLOADS[Math.floor(Math.random() * PAYLOADS.length)] });
      await sock.sendPresenceUpdate('paused', J);
      console.log(`[${id}] envoye`);
    } catch (e) { console.log(`[${id}] echec`, e.message); }
    await delay(4000 + Math.random() * 7000);
  }
  console.log('Rafale terminee. Laisser les fils ouverts 10 min avant 04_report.js');
  process.exit(0);
})();
