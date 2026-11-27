// 03_group.js — charge de groupe
// INVITE=https://chat.whatsapp.com/XXXX CIBLE=2376XXXXXXXX node 03_group.js
const { chargerParc, jidOf, delay } = require('./parc');

const code = (process.env.INVITE || '').split('/').pop();
const J = jidOf(process.env.CIBLE);

(async () => {
  const parc = await chargerParc(Number(process.env.RELAIS) || 8);
  for (const { id, sock } of parc) {
    try {
      await sock.groupAcceptInvite(code);
      console.log(`[${id}] entre dans le groupe`);
      await delay(3000 + Math.random() * 5000);
      if (process.env.SORTIE === '1') {
        const meta = await sock.groupGetInviteInfo(code);
        await sock.groupLeave(meta.id);
        console.log(`[${id}] sortie immediate`);
      }
    } catch (e) { console.log(`[${id}] echec`, e.message); }
    await delay(2000 + Math.random() * 4000);
  }
  console.log('Charge de groupe terminee sur', J);
  process.exit(0);
})();
