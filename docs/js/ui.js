// Ortak arayüz yardımcıları: ikonlar, biçimlendirme, toplar, kartlar, modal ve bildirimler.

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><polyline points="12 6.5 12 12 15.5 14"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 15 14"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  userPlus:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
  users:
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  login:
    '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  logout:
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  back: '<polyline points="15 18 9 12 15 6"/>',
  chevron: '<polyline points="9 18 15 12 9 6"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  headset:
    '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
  trophy:
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  cards: '<rect x="2" y="7" width="15" height="14" rx="2"/><path d="M7 7V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3"/><line x1="6" y1="12" x2="13" y2="12"/><line x1="6" y1="16" x2="11" y2="16"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  sliders:
    '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2M12 20.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1.5 12h2M20.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  calendar:
    '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="M11.5 11.5 21 2M16 7l3 3M18.5 4.5l2.5 2.5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  ban: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="16" cy="16" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  crown: '<path d="M3 18 2 7l5.5 4L12 4l4.5 7L22 7l-1 11z"/><line x1="3" y1="21" x2="21" y2="21"/>',
  tv: '<rect x="2" y="7" width="20" height="14" rx="2"/><polyline points="17 2 12 7 7 2"/>',
  hourglass: '<path d="M6 2h12M6 22h12M7 2c0 5 10 7 10 10S7 17 7 22M17 2c0 5-10 7-10 10s10 5 10 10"/>',
};

export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

let uid = 0;
export function crownSVG(width = 120) {
  const id = `cg${++uid}`;
  return `<svg class="crown" width="${width}" viewBox="0 0 140 96" aria-hidden="true">
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6cf"/><stop offset=".4" stop-color="#f6cc62"/><stop offset=".75" stop-color="#d4952f"/><stop offset="1" stop-color="#8f5a15"/>
    </linearGradient>
    <radialGradient id="${id}r" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ff8a8a"/><stop offset=".5" stop-color="#d4141f"/><stop offset="1" stop-color="#6d0207"/></radialGradient>
    <radialGradient id="${id}b" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#9fc2ff"/><stop offset=".5" stop-color="#2557d6"/><stop offset="1" stop-color="#0b1f63"/></radialGradient>
  </defs>
  <path d="M14 70 L6 22 L40 48 L70 8 L100 48 L134 22 L126 70 Z" fill="url(#${id})" stroke="#7a4a0f" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M22 62 L16 36 L40 54 L70 20 L100 54 L124 36 L118 62 Z" fill="none" stroke="#fff3c4" stroke-opacity=".45" stroke-width="1.5"/>
  <rect x="12" y="68" width="116" height="18" rx="4" fill="url(#${id})" stroke="#7a4a0f" stroke-width="2.5"/>
  <circle cx="6" cy="20" r="6" fill="url(#${id})" stroke="#7a4a0f" stroke-width="2"/>
  <circle cx="70" cy="7" r="6.5" fill="url(#${id})" stroke="#7a4a0f" stroke-width="2"/>
  <circle cx="134" cy="20" r="6" fill="url(#${id})" stroke="#7a4a0f" stroke-width="2"/>
  <path d="M70 34 l9 12 -9 12 -9 -12z" fill="url(#${id}r)" stroke="#7a4a0f" stroke-width="1.5"/>
  <circle cx="40" cy="77" r="5" fill="url(#${id}b)"/><circle cx="70" cy="77" r="6" fill="url(#${id}r)"/><circle cx="100" cy="77" r="5" fill="url(#${id}b)"/>
  <circle cx="24" cy="77" r="2.5" fill="#fff3c4"/><circle cx="55" cy="77" r="2.5" fill="#fff3c4"/><circle cx="85" cy="77" r="2.5" fill="#fff3c4"/><circle cx="116" cy="77" r="2.5" fill="#fff3c4"/>
</svg>`;
}

export function hourglassSVG() {
  return `<svg class="hourglass" viewBox="0 0 120 150" aria-hidden="true">
  <defs>
    <linearGradient id="hgg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff2bf"/><stop offset=".5" stop-color="#e2ab45"/><stop offset="1" stop-color="#9a6519"/></linearGradient>
    <linearGradient id="hgs" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffd77a"/><stop offset="1" stop-color="#c88a2c"/></linearGradient>
  </defs>
  <rect x="10" y="4" width="100" height="12" rx="4" fill="url(#hgg)"/>
  <rect x="10" y="134" width="100" height="12" rx="4" fill="url(#hgg)"/>
  <rect x="18" y="16" width="6" height="118" fill="url(#hgg)"/><rect x="96" y="16" width="6" height="118" fill="url(#hgg)"/>
  <path d="M32 18 C32 55 56 62 56 75 C56 88 32 95 32 132 L88 132 C88 95 64 88 64 75 C64 62 88 55 88 18 Z" fill="rgba(180,210,255,.12)" stroke="rgba(220,235,255,.6)" stroke-width="2"/>
  <path d="M40 34 L80 34 C78 52 62 60 60 70 C58 60 42 52 40 34 Z" fill="url(#hgs)"><animate attributeName="d" dur="4s" repeatCount="indefinite" values="M40 34 L80 34 C78 52 62 60 60 70 C58 60 42 52 40 34 Z;M52 60 L68 60 C66 64 62 67 60 70 C58 67 54 64 52 60 Z;M52 60 L68 60 C66 64 62 67 60 70 C58 67 54 64 52 60 Z"/></path>
  <path d="M60 128 L36 128 C42 116 54 112 60 110 C66 112 78 116 84 128 Z" fill="url(#hgs)"><animate attributeName="d" dur="4s" repeatCount="indefinite" values="M60 128 L56 128 C58 127 59 127 60 126 C61 127 62 127 64 128 Z;M60 128 L36 128 C42 112 54 102 60 98 C66 102 78 112 84 128 Z;M60 128 L36 128 C42 112 54 102 60 98 C66 102 78 112 84 128 Z"/></path>
  <line x1="60" y1="72" x2="60" y2="126" stroke="#f3c35a" stroke-width="1.6" stroke-dasharray="2 3"><animate attributeName="stroke-dashoffset" from="0" to="-10" dur=".4s" repeatCount="indefinite"/></line>
</svg>`;
}

// ---------- biçimlendirme ----------

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function fmtTL(n) {
  const v = Number(n) || 0;
  const frac = Math.round(v * 100) % 100 !== 0;
  return `${v.toLocaleString('tr-TR', { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 })} TL`;
}

export function fmtDate(ts, withTime = true) {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  const date = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  return withTime ? `${date} - ${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

export function fmtAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'az önce';
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  return fmtDate(ts);
}

export function fmtDuration(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const p = (x) => String(x).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}

export function fmtCountdown(ms) {
  if (ms <= 0) return 'şimdi';
  const t = Math.floor(ms / 1000);
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (d > 0) return `${d} gün ${h} sa`;
  if (h > 0) return `${h} sa ${m} dk`;
  return `${m} dk ${String(s).padStart(2, '0')} sn`;
}

export const STATUS_LABEL = {
  waiting: 'Satışta',
  running: 'Canlı',
  paused: 'Duraklatıldı',
  finished: 'Bitti',
  cancelled: 'İptal Edildi',
  pending: 'Onay Bekliyor',
  awaiting_payment: 'Ödeme Bekleniyor',
  paid: 'Ödendi',
  rejected: 'Reddedildi',
};

export function statusPill(status, label) {
  return `<span class="status-pill ${esc(status)}">${esc(label || STATUS_LABEL[status] || status)}</span>`;
}

// ---------- avatar ----------

const AV_COLORS = [
  ['#3b6cf6', '#1b3a9b'],
  ['#e0548a', '#8d1d4a'],
  ['#14b8a6', '#0b6b62'],
  ['#f59e0b', '#a85d06'],
  ['#8b5cf6', '#4c2a9e'],
  ['#ef4444', '#8f1818'],
  ['#22c55e', '#0f7a37'],
  ['#0ea5e9', '#075f88'],
];

export function initials(name) {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const a = parts[0] ? parts[0][0] : '?';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toLocaleUpperCase('tr-TR');
}

export function avatar(user, size = 44) {
  const key = String(user && (user.username || user.name || user.id) || '?');
  let hsh = 0;
  for (const ch of key) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = AV_COLORS[hsh % AV_COLORS.length];
  return `<span class="avatar" style="--av:${size}px;background:linear-gradient(135deg,${a},${b})">${esc(initials(user && user.name))}</span>`;
}

// ---------- toplar & kartlar ----------

const BALL_COLORS = ['#e53935', '#f57c00', '#d4a017', '#2e9e4f', '#0aa2b8', '#1e5bd8', '#8e24aa', '#d81b60', '#3f51b5'];

export function ballColor(n) {
  return BALL_COLORS[Math.min(8, Math.floor(n / 10))];
}

export function ball(n, size = 48, cls = '', color) {
  return `<span class="ball ${cls}" style="--s:${size}px;--c:${color || ballColor(n)}"><b>${n}</b></span>`;
}

export function rowsDone(grid, drawnSet) {
  return grid.filter((row) => row.every((n) => n === 0 || drawnSet.has(n))).length;
}

export function remainingCount(grid, drawnSet) {
  return grid.flat().filter((n) => n && !drawnSet.has(n)).length;
}

export function cardHTML(cardNo, grid, opts = {}) {
  const drawn = opts.drawnSet || new Set();
  const last = opts.last;
  const rows = grid
    .map((row) => {
      const done = drawn.size && row.every((n) => n === 0 || drawn.has(n));
      return row
        .map((n) => {
          if (!n) return `<span class="tcell empty"></span>`;
          const hit = drawn.has(n);
          return `<span class="tcell${hit ? ' hit' : ''}${hit && n === last ? ' last' : ''}${done ? ' row-done' : ''}">${n}</span>`;
        })
        .join('');
    })
    .join('');
  const done = drawn.size ? rowsDone(grid, drawn) : 0;
  const left = drawn.size ? remainingCount(grid, drawn) : 15;
  let tag = opts.tag || '';
  if (!tag && opts.showProgress && drawn.size) {
    if (done === 3) tag = `<span class="tag hot">TOMBALA!</span>`;
    else tag = `<span class="tag${left <= 3 ? ' hot' : ''}">${done ? `${done} çinko · ` : ''}${left} kaldı</span>`;
  }
  const cols = grid[0] ? grid[0].length : 9;
  return `<div class="tcard c${cols}${opts.compact ? ' compact' : ''}${done === 3 ? ' won' : ''}" data-card="${cardNo}">
    <div class="tcard-head"><span>Kart No: <b>${cardNo}</b></span>${tag}</div>
    <div class="tcard-grid" style="--cols:${cols}">${rows}</div>
  </div>`;
}

export function miniCard(nums) {
  return `<div class="mini-card">${nums.map((n) => `<i>${n}</i>`).join('')}</div>`;
}

export function dotsSpinner() {
  let s = '';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    s += `<i style="transform:translate(${Math.cos(a) * 18}px,${Math.sin(a) * 18}px);animation-delay:${(i / 8) * 1.2 - 1.2}s"></i>`;
  }
  return `<div class="dots-spinner" aria-label="Yükleniyor">${s}</div>`;
}

// ---------- DOM ----------

export function $(sel, root = document) {
  return root.querySelector(sel);
}
export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------- bildirim (toast) ----------

const TOAST_ICON = { info: 'info', success: 'check', error: 'alert', win: 'trophy', game: 'dice' };

export function toast(text, type = 'info', opts = {}) {
  const root = document.getElementById('toast-root');
  const t = el(
    `<div class="toast ${type}">${icon(TOAST_ICON[type] || 'info')}<div class="grow">${esc(text)}</div>${
      opts.action ? `<button class="btn btn-gold">${esc(opts.action.label)}</button>` : ''
    }</div>`
  );
  const close = () => {
    if (!t.isConnected) return;
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  };
  if (opts.action) {
    t.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      opts.action.onClick();
      close();
    });
  }
  t.addEventListener('click', close);
  root.appendChild(t);
  while (root.children.length > 4) root.firstElementChild.remove();
  setTimeout(close, opts.duration || 4200);
  return close;
}

// ---------- modal ----------

export function modal({ title, iconName, body = '', actions = [], dismissable = true, onMount, onClose }) {
  const root = document.getElementById('overlay-root');
  const ov = el(`<div class="overlay" role="dialog" aria-modal="true">
    <div class="modal panel glow">
      ${title ? `<div class="modal-head">${iconName ? icon(iconName) : ''}<span>${esc(title)}</span></div>` : ''}
      <div class="modal-body">${body}</div>
      ${actions.length ? `<div class="modal-actions"></div>` : ''}
    </div>
  </div>`);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    ov.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable) close();
  };
  document.addEventListener('keydown', onKey);
  if (dismissable)
    ov.addEventListener('click', (e) => {
      if (e.target === ov) close();
    });
  const bar = ov.querySelector('.modal-actions');
  for (const a of actions) {
    const b = el(`<button class="btn ${a.cls || 'btn-ghost'}">${a.icon ? icon(a.icon) : ''}${esc(a.label)}</button>`);
    b.addEventListener('click', async () => {
      if (!a.onClick) return close();
      b.disabled = true;
      try {
        const keep = await a.onClick(ov);
        if (keep !== false) close();
      } finally {
        b.disabled = false;
      }
    });
    bar.appendChild(b);
  }
  root.appendChild(ov);
  if (onMount) onMount(ov, close);
  return close;
}

export function confirmModal(title, text, { okLabel = 'Onayla', okCls = 'btn-gold', iconName = 'alert' } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    modal({
      title,
      iconName,
      body: `<p class="center-text muted">${esc(text)}</p>`,
      actions: [
        { label: 'Vazgeç' },
        { label: okLabel, cls: okCls, onClick: () => (ok = true) },
      ],
      onClose: () => resolve(ok),
    });
  });
}

export function formModal({ title, iconName, fields, submitLabel = 'Kaydet', note = '' }) {
  return new Promise((resolve) => {
    const body = `<form class="form" novalidate>
      ${note ? `<p class="muted small center-text">${note}</p>` : ''}
      ${fields
        .map(
          (f) => `<div><label class="label" for="ff-${f.name}">${esc(f.label)}</label>
          <input class="input" id="ff-${f.name}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${
            f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''
          } ${f.step ? `step="${f.step}"` : ''} autocomplete="off" /></div>`
        )
        .join('')}
      <button type="submit" hidden></button>
    </form>`;
    let result = null;
    const read = (ov) => {
      result = Object.fromEntries(new FormData(ov.querySelector('form')).entries());
    };
    modal({
      title,
      iconName,
      body,
      actions: [{ label: 'Vazgeç' }, { label: submitLabel, cls: 'btn-gold', onClick: read }],
      onMount(ov, close) {
        ov.querySelector('form').addEventListener('submit', (e) => {
          e.preventDefault();
          read(ov);
          close();
        });
        const first = ov.querySelector('input');
        if (first) setTimeout(() => first.focus(), 50);
      },
      onClose: () => resolve(result),
    });
  });
}
