// 05_presence.js — presence fantome + saisie maintenue
// CIBLE=2376XXXXXXXX node 05_presence.js
const { chargerParc, jidOf, delay } = require('./parc');

const J = jidOf(process.env.CIBLE);

(async () => {
  const parc = await chargerParc();
  for (const { id, sock } of parc) {
    await sock.presenceSubscribe(J).catch(() => {});
    const boucle = async () => {
      try {
        await sock.sendPresenceUpdate('available', J);
        await delay(4000);
        await sock.sendPresenceUpdate('composing', J);
        await delay(6000);
        await sock.sendPresenceUpdate('paused', J);
      } catch (e) {}
    };
    boucle();
    setInterval(boucle, 25000);
    console.log(`[${id}] presence armee`);
  }
  console.log('Ctrl+C pour couper.');
})();
