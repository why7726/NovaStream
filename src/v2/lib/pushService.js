// Notifications push — abonnement du navigateur au serveur NovaStream.
// Nécessite HTTPS (déjà en place via Caddy) et un service worker enregistré.
import authService from '../../services/authService';

const apiBase = () => (import.meta.env.DEV ? 'http://localhost:5174' : '');

const headers = () => {
  const t = authService.getToken();
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};

export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && window.isSecureContext;
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** État courant : { supported, permission, subscribed } */
export async function pushStatus() {
  if (!pushSupported()) return { supported: false, permission: 'unsupported', subscribed: false };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { supported: true, permission: Notification.permission, subscribed: !!sub };
}

export async function subscribePush() {
  if (!pushSupported()) throw new Error('Non supporté sur cet appareil');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications refusées');

  const reg = await navigator.serviceWorker.ready;
  const r = await fetch(`${apiBase()}/api/push/key`, { headers: headers() });
  if (!r.ok) throw new Error('Serveur indisponible');
  const { publicKey } = await r.json();

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const res = await fetch(`${apiBase()}/api/push/subscribe`, {
    method: 'POST', headers: headers(), body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) throw new Error('Enregistrement impossible');
  return true;
}

export async function unsubscribePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await fetch(`${apiBase()}/api/push/unsubscribe`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return true;
}

export async function testPush() {
  await fetch(`${apiBase()}/api/push/test`, { method: 'POST', headers: headers() });
}

export default { pushSupported, pushStatus, subscribePush, unsubscribePush, testPush };
