import React from 'react';

// Renders a watch-party avatar: either an imported photo (data URL) or the
// Kahoot-style emoji animal on a colored disc with an optional accessory.
export default function WatchAvatar({ avatar, name, size = 48 }) {
  const px = `${size}px`;
  if (avatar?.type === 'photo' && avatar.url) {
    return (
      <img src={avatar.url} alt={name || ''} style={{ width: px, height: px }}
        className="rounded-full object-cover ring-2 ring-white/20 shadow-lg" />
    );
  }
  if (avatar?.type === 'emoji') {
    const acc = { hat: '🎩', glasses: '🕶️', crown: '👑', party: '🎉' }[avatar.accessory];
    return (
      <div className="relative rounded-full flex items-center justify-center ring-2 ring-white/20 shadow-lg shrink-0"
        style={{ width: px, height: px, background: avatar.color || '#6366F1' }}>
        <span style={{ fontSize: size * 0.52 }}>{avatar.animal || '🙂'}</span>
        {acc && <span className="absolute -top-1 -right-1" style={{ fontSize: size * 0.4 }}>{acc}</span>}
      </div>
    );
  }
  // Fallback: initial on a disc.
  return (
    <div className="rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-rose-500 text-white font-black ring-2 ring-white/20 shadow-lg shrink-0"
      style={{ width: px, height: px, fontSize: size * 0.42 }}>
      {(name || '?').charAt(0).toUpperCase()}
    </div>
  );
}
