import { tr } from '../../i18n';
// Kahoot-style guest identity helpers: random funny French names + a palette
// of emoji avatars (animals) with optional accessories.

const ADJ = [
  'Rusé', 'des prés', 'Malin', 'Farceur', 'du dimanche', 'Turbo', 'Cosmique',
  'Ninja', 'Endormi', 'Gourmand', 'Rebelle', 'Zen', 'Électrique', 'des bois',
  'Masqué', 'Pixelisé', 'Nocturne', 'Suprême',
];
const ANIMALS = [
  'Chamois', 'Renard', 'Panda', 'Raton', 'Hibou', 'Castor', 'Blaireau', 'Lynx',
  'Écureuil', 'Loutre', 'Furet', 'Wombat', 'Suricate', 'Tatou', 'Capybara',
  'Hérisson', 'Koala', 'Morse',
];

export function randomName() {
  const a = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const b = ADJ[Math.floor(Math.random() * ADJ.length)];
  return `${a} ${b}`;
}

// Avatar animals (Kahoot vibe) — emoji is universal & needs no assets.
export const AVATAR_ANIMALS = ['🦊', '🐼', '🦉', '🐨', '🦁', '🐯', '🐸', '🐵', '🦝', '🐹', '🐧', '🦄', '🐙', '🐳', '🦖', '🐷'];
export const AVATAR_ACCESSORIES = [
  { id: 'none', label: tr('Aucun'), emoji: '' },
  { id: 'hat', label: tr('Chapeau'), emoji: '🎩' },
  { id: 'glasses', label: tr('Lunettes'), emoji: '🕶️' },
  { id: 'crown', label: tr('Couronne'), emoji: '👑' },
  { id: 'party', label: tr('Fête'), emoji: '🎉' },
];
export const AVATAR_COLORS = ['#6366F1', '#E11D48', '#0EA5E9', '#22C55E', '#F59E0B', '#A855F7', '#EC4899', '#14B8A6'];

export function randomAvatar() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return { type: 'emoji', animal: pick(AVATAR_ANIMALS), accessory: pick(AVATAR_ACCESSORIES).id, color: pick(AVATAR_COLORS) };
}
