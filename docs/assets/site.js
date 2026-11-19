import { locales } from './site-locales.js';

const repo = 'https://github.com/jhlee0409/omnilogue';
const releases = `${repo}/releases/latest`;
const platformInfo = {
  macos: { name: 'macOS', file: /_universal\.dmg$/i, label: 'macDownload' },
  windows: { name: 'Windows', file: /_x64-setup\.exe$/i, label: 'winDownload' },
  linux: { name: 'Linux', file: /_amd64\.AppImage$/, label: 'linuxDownload' },
  flatpak: { name: 'Flatpak', file: /_x86_64\.flatpak$/i },
};
const language = document.getElementById('lang-select');
const primary = document.getElementById('download-primary');
const primaryLabel = document.getElementById('primary-label');
const version = document.getElementById('latest-version');
const serverGuide = document.getElementById('server-guide');
const downloadLinks = document.querySelectorAll('[data-asset]');
const platform = desktopPlatform();
let assets = {};

function desktopPlatform() {
  const agent = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(agent) || navigator.userAgentData?.mobile ||
      (/Macintosh/i.test(agent) && navigator.maxTouchPoints > 1)) return null;
  if (/Windows/i.test(agent)) return /ARM/i.test(agent) ? null : 'windows';
  if (/Macintosh/i.test(agent)) return 'macos';
  if (/Linux.*(?:x86_64|x86-64|amd64)/i.test(agent)) return 'linux';
  return null;
}

function savedLanguage() {
  try { return localStorage.getItem('lang'); } catch { return null; }
}

function matchLanguage(candidate) {
  if (!candidate) return null;
  const tag = candidate.toLowerCase().split('-');
  const [base] = tag;
  if (base === 'zh') return tag.some(part => ['hant', 'tw', 'hk', 'mo'].includes(part)) ? 'zh-TW' : 'zh-CN';
  return Object.hasOwn(locales, base) ? base : null;
}

function renderDownloads() {
  const t = locales[language.value];
  for (const link of downloadLinks) {
    const key = link.dataset.asset;
    const info = platformInfo[key];
    link.href = assets[key] || releases;
    link.firstElementChild.textContent = assets[key] ? (t[info.label] || info.name) : t.releaseFallback.replace('{platform}', info.name);
  }
  const asset = platform && assets[platform];
  primary.href = asset || '#downloads';
  primaryLabel.textContent = asset ? t.platformDownload.replace('{platform}', platformInfo[platform].name) : t.chooseDownload;
}

function applyLanguage(lang) {
  const t = locales[lang];
  language.value = lang;
  document.documentElement.lang = lang;
  for (const element of document.querySelectorAll('[data-t]')) element.textContent = t[element.dataset.t];
  for (const element of document.querySelectorAll('[data-label]')) element.setAttribute('aria-label', t[element.dataset.label]);
  for (const element of document.querySelectorAll('[data-alt]')) element.alt = t[element.dataset.alt];
  document.title = `Omnilogue — ${t.heroLine1} ${t.heroLine2}`;
  serverGuide.href = `${repo}/blob/main/docs/server-guide${lang === 'ko' ? '.ko' : ''}.md`;
  renderDownloads();
}

language.addEventListener('change', () => {
  const lang = language.value;
  try { localStorage.setItem('lang', lang); } catch { /* Language still works without storage. */ }
  const url = new URL(location.href);
  url.searchParams.set('lang', lang);
  history.replaceState(null, '', url);
  applyLanguage(lang);
});

const requestedLanguage = new URLSearchParams(location.search).get('lang');
applyLanguage([requestedLanguage, savedLanguage(), ...(navigator.languages || [navigator.language])].map(matchLanguage).find(Boolean) || 'en');

async function loadRelease() {
  try {
    const response = await fetch('https://api.github.com/repos/jhlee0409/omnilogue/releases/latest');
    if (!response.ok) return;
    const release = await response.json();
    if (typeof release.tag_name !== 'string' || !/^v\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) return;
    const base = `${repo}/releases/download/${release.tag_name}`;
    assets = Object.fromEntries(Object.entries(platformInfo).flatMap(([key, info]) => {
      const asset = release.assets.find(({ name }) => typeof name === 'string' && info.file.test(name));
      return asset ? [[key, `${base}/${encodeURIComponent(asset.name)}`]] : [];
    }));
    version.textContent = release.tag_name;
    version.hidden = false;
    renderDownloads();
  } catch { /* Keep the links to the public release page when GitHub is unavailable. */ }
}

loadRelease();
