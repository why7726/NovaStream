/* Télécharge mpv pour Windows dans vendor/mpv/ (ignoré par Git).

   Source : les versions Windows que recommande mpv.io
   (github.com/shinchiro/mpv-winbuild-cmake). On prend la variante x86_64
   « générique » plutôt que « v3 » : elle tourne aussi sur les processeurs
   anciens des amis à qui on passe l'application.

   Décompression : le `tar` de Windows 10/11 (bsdtar/libarchive) lit le 7z.

   Usage : npm run mpv            (ne refait rien si mpv est déjà là)
           npm run mpv -- --force */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const CIBLE = path.join(ICI, '..', 'vendor', 'mpv');
const force = process.argv.includes('--force');

if (!force && fs.existsSync(path.join(CIBLE, 'mpv.exe'))) {
  console.log('mpv est déjà là :', CIBLE);
  process.exit(0);
}

const rel = await (await fetch('https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest', {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'novastream-desktop' },
})).json();
const asset = (rel.assets || []).find((a) => /^mpv-x86_64-\d{8}-git-[0-9a-f]+\.7z$/.test(a.name));
if (!asset) throw new Error('Archive mpv x86_64 introuvable dans la dernière version');

console.log(`Téléchargement de ${asset.name} (${Math.round(asset.size / 1e6)} Mo)…`);
const archive = path.join(ICI, '..', 'vendor', asset.name);
fs.mkdirSync(path.dirname(archive), { recursive: true });
const r = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'novastream-desktop' } });
if (!r.ok) throw new Error(`Téléchargement refusé (${r.status})`);
fs.writeFileSync(archive, Buffer.from(await r.arrayBuffer()));
if (fs.statSync(archive).size !== asset.size) throw new Error('Archive incomplète');

fs.rmSync(CIBLE, { recursive: true, force: true });
fs.mkdirSync(CIBLE, { recursive: true });
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar';
execFileSync(tar, ['-xf', archive, '-C', CIBLE], { stdio: 'inherit' });
fs.rmSync(archive);

if (!fs.existsSync(path.join(CIBLE, 'mpv.exe'))) throw new Error('mpv.exe absent après décompression');
fs.writeFileSync(path.join(CIBLE, 'VERSION.txt'), `${asset.name}\n${rel.html_url}\n`);
console.log('mpv prêt :', CIBLE);
