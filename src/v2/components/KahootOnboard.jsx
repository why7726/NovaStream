import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Shuffle, Upload, ArrowRight } from 'lucide-react';
import WatchAvatar from './WatchAvatar';
import { AVATAR_ANIMALS, AVATAR_ACCESSORIES, AVATAR_COLORS, randomName, randomAvatar } from '../lib/watchNames';

import { tr } from '../../i18n';
// Kahoot-style guest onboarding: pick a name + animal avatar (+ accessory /
// color / imported photo), or hit "Passer" for a random funny identity.
export default function KahootOnboard({ onDone }) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(() => randomAvatar());
  const fileRef = useRef(null);

  const set = (patch) => setAvatar((a) => ({ ...a, ...patch, type: 'emoji' }));

  const importPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatar({ type: 'photo', url: reader.result });
    reader.readAsDataURL(file);
  };

  const skip = () => onDone({ name: randomName(), avatar: randomAvatar() });
  const confirm = () => onDone({ name: name.trim() || randomName(), avatar });

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md mx-auto glass-panel rounded-3xl p-6 md:p-8">
      <div className="flex flex-col items-center">
        <WatchAvatar avatar={avatar} name={name} size={92} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          placeholder={tr('Ton pseudo…')}
          className="mt-5 w-full text-center text-lg font-bold bg-white/[0.06] border border-white/10 rounded-2xl px-4 py-3 outline-none focus:border-white/30 transition-colors"
        />
      </div>

      {avatar.type !== 'photo' && (
        <>
          {/* Animals */}
          <div className="mt-6">
            <p className="p-label mb-2">{tr('Personnage')}</p>
            <div className="grid grid-cols-8 gap-1.5">
              {AVATAR_ANIMALS.map((a) => (
                <button key={a} onClick={() => set({ animal: a })}
                  className={`aspect-square rounded-xl text-xl flex items-center justify-center transition-all ${avatar.animal === a ? 'bg-white/20 ring-2 ring-white/70' : 'bg-white/[0.04] hover:bg-white/10'}`}>
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Colors */}
          <div className="mt-4">
            <p className="p-label mb-2">{tr('Couleur')}</p>
            <div className="flex gap-2 flex-wrap">
              {AVATAR_COLORS.map((c) => (
                <button key={c} onClick={() => set({ color: c })}
                  style={{ background: c }}
                  className={`w-8 h-8 rounded-full transition-all ${avatar.color === c ? 'ring-2 ring-white scale-110' : 'ring-1 ring-white/20'}`} />
              ))}
            </div>
          </div>

          {/* Accessories */}
          <div className="mt-4">
            <p className="p-label mb-2">{tr('Accessoire')}</p>
            <div className="flex gap-2 flex-wrap">
              {AVATAR_ACCESSORIES.map((acc) => (
                <button key={acc.id} onClick={() => set({ accessory: acc.id })}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 transition-all ${avatar.accessory === acc.id ? 'bg-white/20 ring-1 ring-white/40' : 'bg-white/[0.04] hover:bg-white/10'}`}>
                  {acc.emoji && <span>{acc.emoji}</span>}{acc.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Photo import / reset */}
      <div className="mt-5 flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" onChange={importPhoto} className="hidden" />
        <button onClick={() => fileRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-sm font-semibold hover:bg-white/10 transition-colors">
          <Upload size={16} /> {tr('Importer une photo')}
        </button>
        {avatar.type === 'photo' && (
          <button onClick={() => setAvatar(randomAvatar())}
            className="py-2.5 px-4 rounded-xl bg-white/[0.06] border border-white/10 text-sm font-semibold hover:bg-white/10 transition-colors">
            {tr('Emoji')}
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="mt-6 flex items-center gap-3">
        <button onClick={skip}
          className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-white/[0.06] border border-white/10 text-sm font-bold text-gray-300 hover:bg-white/10 transition-colors">
          <Shuffle size={16} /> {tr('Passer')}
        </button>
        <button onClick={confirm}
          className="flex-1 flex items-center justify-center gap-2 h-[48px] rounded-full bg-white text-black text-[15px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all">
          {tr('Rejoindre')} <ArrowRight size={18} />
        </button>
      </div>
    </motion.div>
  );
}
