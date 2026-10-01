import React, { useState, useEffect } from 'react';
import { X, Share, Plus, Download } from 'lucide-react';

import { tr } from '../../i18n';
/* Invitation à installer Nova sur l'écran d'accueil.

   Android/Chrome propose l'installation tout seul (on récupère l'événement
   pour offrir un vrai bouton). iOS ne propose RIEN : il faut passer par
   Partager → Sur l'écran d'accueil, et personne ne le devine. D'où ce
   rappel, discret, affiché une fois, et jamais quand l'app est déjà
   installée. */

const KEY = 'nova_install_hint';

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function InstallPure() {
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState(null);   // Android : événement d'installation

  useEffect(() => {
    if (isStandalone()) return;                 // déjà installée : rien à dire
    try { if (localStorage.getItem(KEY) === '1') return; } catch {}

    const onPrompt = (e) => {
      e.preventDefault();
      setPrompt(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    // iOS n'émet jamais cet événement : on affiche le mode d'emploi après
    // quelques secondes, le temps que la page ait fini de s'installer à l'écran.
    let t;
    if (isIOS()) t = setTimeout(() => setShow(true), 4000);

    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); clearTimeout(t); };
  }, []);

  const close = () => {
    setShow(false);
    try { localStorage.setItem(KEY, '1'); } catch {}
  };

  const install = async () => {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice.catch(() => {});
    close();
  };

  if (!show) return null;

  return (
    <div className="fixed inset-x-3 bottom-[86px] md:bottom-6 md:left-auto md:right-6 md:w-[380px] z-[120] p-in">
      <div className="rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-2xl border border-white/10 p-4 pr-3">
        <div className="flex items-start gap-3">
          <img src="/icon-192.png" alt="" className="w-11 h-11 rounded-xl shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-semibold">{tr('Installer NovaStream')}</p>
            {prompt ? (
              <p className="text-[12.5px] text-white/55 mt-0.5">
                {tr('Pour l\'avoir en application, plein écran, avec les notifications.')}
              </p>
            ) : (
              <p className="text-[12.5px] text-white/55 mt-1 leading-relaxed">
                {tr('Touche')} <Share size={13} className="inline -mt-0.5" /> {tr('en bas de Safari, puis')} <span className="text-white/80">{tr('« Sur l\'écran d\'accueil »')}</span>
                <Plus size={13} className="inline -mt-0.5 ml-0.5" />.
              </p>
            )}
          </div>
          <button onClick={close} aria-label={tr('Fermer')} className="text-white/40 hover:text-white transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {prompt && (
          <button onClick={install}
            className="mt-3 w-full h-10 rounded-full bg-white text-black text-[14px] font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all">
            <Download size={15} /> {tr('Installer')}
          </button>
        )}
      </div>
    </div>
  );
}
