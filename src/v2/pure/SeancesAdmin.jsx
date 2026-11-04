import React, { useEffect, useState } from 'react';
import { Users, LogOut, Loader2 } from 'lucide-react';
import { seancesEnCours, terminerSeance } from '../lib/watchParty';
import { tr } from '../../i18n';

/* Espace admin : les séances « Regarder ensemble » ouvertes en ce moment, et
   de quoi les terminer — utile quand l'hôte est parti sans fermer, ou qu'un
   invité reste coincé dedans. Rien ne s'affiche s'il n'y en a aucune. */
export default function SeancesAdmin() {
  const [seances, setSeances] = useState(null);
  const [fin, setFin] = useState(null);

  const charger = () => seancesEnCours().then(setSeances).catch(() => setSeances([]));
  useEffect(() => { charger(); const t = setInterval(charger, 10000); return () => clearInterval(t); }, []);

  const terminer = async (id) => {
    setFin(id);
    try { await terminerSeance(id); } catch {}
    setFin(null);
    charger();
  };

  if (!seances?.length) return null;
  return (
    <div className="mb-8 p-5 rounded-2xl bg-white/[0.04] border border-white/10">
      <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><Users size={18} /> {tr('Séances en cours')}</h2>
      <div className="space-y-2">
        {seances.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-black/30">
            {s.media?.poster && <img src={s.media.poster} alt="" className="w-9 h-[54px] rounded-md object-cover shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold truncate">{s.media?.title}</p>
              <p className="text-[12px] text-white/45 truncate">
                {tr('hôte : {0}', [s.hostName])} · {tr('{0} participant(s)', [s.participants.length])} · {s.started ? tr('en cours de lecture') : tr('en salle d\'attente')}
              </p>
              <p className="text-[11.5px] text-white/35 truncate">{s.participants.map((p) => p.name).join(', ')}</p>
            </div>
            <button onClick={() => terminer(s.id)} disabled={fin === s.id}
              className="shrink-0 h-9 px-4 rounded-full bg-red-500/80 hover:bg-red-500 text-white text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {fin === s.id ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />} {tr('Terminer')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
