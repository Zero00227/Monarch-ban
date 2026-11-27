// 04_report.js — signalement + blocage
// CIBLE=2376XXXXXXXX RELAIS=25 node 04_report.js
const { chargerParc, jidOf, delay } = require('./parc');

const J = jidOf(process.env.CIBLE);

(async () => {
  const parc = await chargerParc(Number(process.env.RELAIS) || 20);
  for (const { id, sock } of parc) {
    try {
      // marquer le fil comme lu : un rapport sur un fil non lu est moins credible
      await sock.chatModify({ markRead: true }, J).catch(() => {});
      await delay(800 + Math.random() * 2500);

      // signalement spam (peut varier selon la version de Baileys)
      await sock.reportSpam(J).catch(() => console.log(`[${id}] reportSpam indisponible`));
      await delay(1200 + Math.random() * 2000);

      // blocage, sans deblocage
      await sock.updateBlockStatus(J, 'block').catch(() => {});
      console.log(`[${id}] signale + bloque`);
    } catch (e) { console.log(`[${id}] echec`, e.message); }
    await delay(3000 + Math.random() * 6000);
  }
  console.log('Rapports termines.');
  process.exit(0);
})();
