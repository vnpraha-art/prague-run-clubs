/* Prague Run Clubs — app logic. Plain script, no build step.

   Data contract (unchanged): SCRIPT_URL returns an array of rows from the Google Sheet:
   { id, name, category, days[], time, timeFilter[], distFilter[], distText, pace, meet, lat, lng, free, desc, link }
   One row is one session of a club; the club name is the part before " — ". */
(() => {
'use strict';

/* ── Configuration ──────────────────────────────────────────────────── */
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzOCpxw77484zKkgfuDMzztZnfY_tfcj-YYXi8--xDytQ6C8zz96iHCmXJ4QEfIzrh5BQ/exec";
const SNAPSHOT_URL = '/clubs-snapshot.json';     // last-resort copy shipped with the app
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=50.0755&longitude=14.4378&hourly=temperature_2m,precipitation_probability,weather_code&timezone=Europe%2FPrague&forecast_days=8';
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

const SAVED_KEY = 'prc_clubs_v1';                // same key and shape as the previous version
const PREFS_KEY = 'prc_prefs_v1';
const WX_KEY = 'prc_wx_v1';
const DISMISS_KEY = 'prc_install_dismissed';

const PRAGUE = { lat: 50.0755, lng: 14.4378 };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIMEOFDAY = ["Morning", "Afternoon", "Evening"];
const DISTANCES = ["Up to 5 km", "5–10 km", "10+ km", "Track / Intervals", "Varies / Social"];
const PACES = ["< 5:00", "5:00–6:00", "6:00–7:00", "7:00+", "Social / varied"];
const SOON_MIN = 90;                             // "starting soon" window
const HALF = 0.56;                               // half-open sheet, share of the screen height

// Vibes are read out of the free-text columns, so they only appear when the wording supports them.
const VIBES = [
  ['Social',            c => /social|relaxed|casual|conversational/i.test(c.pace + ' ' + c.desc + ' ' + c.name)],
  ['Coffee after',      c => /coffee|breakfast|bakery|brunch|drinks/i.test(c.desc)],
  ['Beginner-friendly', c => /beginner|all levels|all welcome|all abilities/i.test(c.desc + ' ' + c.pace)],
  ['Coach-led',         c => /coach|trainer/i.test(c.desc + ' ' + c.pace)],
  ['Speed work',        c => c.distFilter.includes('Track / Intervals') || /interval|tempo|speed/i.test(c.desc)],
  ['Long run',          c => /long run/i.test(c.name + ' ' + c.desc)],
  ['Trail',             c => /trail/i.test(c.pace + ' ' + c.distText + ' ' + c.desc)],
  ['Dog-friendly',      c => /dog|pets/i.test(c.desc)],
];

const ICON = (() => {
  const s = (d, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  return {
    locate: s('<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>'),
    more: s('<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>'),
    sliders: s('<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.4"/><circle cx="8" cy="17" r="2.4"/>', 17),
    back: s('<path d="M15 5l-7 7 7 7"/>', 22),
    close: s('<path d="M6 6l12 12M18 6L6 18"/>'),
    x: s('<path d="M7 7l10 10M17 7L7 17"/>', 13),
    star: s('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>'),
    starOn: s('<path fill="currentColor" d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>'),
    starSm: '<svg class="star" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
    share: s('<path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
    dir: s('<path d="M15 14l5-5-5-5"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>', 17),
    cal: s('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v4.5M9.75 15.25h4.5"/>', 17),
    ext: s('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>', 17),
    moon: s('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>', 13),
    moonLg: s('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>', 16),
  };
})();

/* ── State ──────────────────────────────────────────────────────────── */
const S = {
  clubs: [], byId: new Map(), sessions: [], byDay: {}, floating: [], rawJson: '',
  source: null, savedAt: 0, loading: true,
  dayIdx: 0, view: 'day', q: '',
  f: { tod: new Set(), dist: new Set(), pace: new Set(), vibe: new Set(), cat: new Set(), free: false, saved: false },
  sel: null, prev: null, finder: false,
  snap: 'half', y: 0,
  user: null, wx: null,
  prefs: { theme: 'auto', saved: [] }, saved: new Set(),
};
let T = null;                                    // clock: { now, base, week[] } in Prague time
let map = null, mapReady = false;
const pins = new Map();                          // club id -> { marker, el }
let meMarker = null;

const $ = id => document.getElementById(id);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const desk = window.matchMedia('(min-width: 860px)');
const el = {};
['map', 'sheet', 'sheetHead', 'grab', 'next', 'scroll', 'status', 'chips', 'days', 'dayMeta', 'dayList', 'lanes', 'weekNote',
 'search', 'clubList', 'detail', 'finder', 'btnFind', 'btnLocate', 'btnAbout', 'about', 'toast', 'safeProbe'].forEach(k => el[k] = $(k));

/* ── Helpers ────────────────────────────────────────────────────────── */
// Club data comes from a public Google Sheet, so every value is escaped before it
// goes into HTML and links are limited to http(s).
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
function safeUrl(u) {
  try {
    const url = new URL(String(u ?? '').trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : '';
  } catch { return ''; }
}
function toArray(v) { return Array.isArray(v) ? v.map(String) : String(v ?? '').split(/\s*,\s*/).filter(Boolean); }
function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
function listText(items) { return items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]; }

// The club itself, without the session suffix: "Nomilesnosmiles — Wed Track" → "Nomilesnosmiles"
function baseName(name) { return String(name).split(/\s+[—–]\s+/)[0].trim(); }

// Stable avatar label per club, so every session of a club gets the same one.
function getInitials(name) {
  let base = baseName(name);
  const paren = base.match(/\(([A-Z0-9]{2,4})\)/);
  if (paren) return paren[1];
  base = base.replace(/\(.*?\)/g, '').replace(/[.]/g, ' ');
  const stop = new Set(['the', 'and', 'with', '&', 'a', 'of']);
  const skip = new Set(['run', 'club', 'running', 'runclub']);
  const all = base.split(/\s+/).filter(w => w && !stop.has(w.toLowerCase()));
  let words = all.filter(w => !skip.has(w.toLowerCase()));
  if (!words.length) words = all;
  if (words.length === 1 && /^[A-Z]{2,5}$/.test(words[0])) return words[0];
  if (words.length === 1 && all.length >= 2 && skip.has(all[0].toLowerCase())) return all.slice(0, 3).map(x => x[0]).join('').toUpperCase();
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] || base;
  if (/^\d+$/.test(w)) return w.slice(0, 4);
  if (/^[A-Z]{2,5}$/.test(w)) return w;
  const digit = w.slice(1).match(/\d/);
  if (digit) return (w[0] + digit[0]).toUpperCase();
  const cons = w.slice(1).match(/[bcdfghjklmnpqrstvwxz]/i);
  return (w[0] + (cons ? cons[0] : (w[1] || ''))).toUpperCase();
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, d2r = Math.PI / 180;
  const dLat = (lat2 - lat1) * d2r, dLng = (lng2 - lng1) * d2r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Same pace buckets as before: "6:10–6:30" or "6.2" are numeric, words are "Social / varied".
function paceMatch(clubPace, filter) {
  const p = String(clubPace).toLowerCase().trim();
  const mColon = p.match(/(\d{1,2}):(\d{2})/);
  const mDec = p.match(/\b(\d{1,2}\.\d+)\b/);
  let n = null;
  if (mColon) n = parseInt(mColon[1], 10) + parseInt(mColon[2], 10) / 60;
  else if (mDec) n = parseFloat(mDec[1]);
  if (filter === "Social / varied") return n === null;
  if (n === null) return false;
  if (filter === "< 5:00") return n < 5;
  if (filter === "5:00–6:00") return n >= 5 && n < 6;
  if (filter === "6:00–7:00") return n >= 6 && n < 7;
  if (filter === "7:00+") return n >= 7;
  return false;
}

/* ── Days and start times (free text in the Sheet) ──────────────────── */
function daysVary(c) { return !c.days.some(d => DAYS.includes(d)); }

function clockTimes(text) {
  return [...String(text).matchAll(/\b(\d{1,2})[:.](\d{2})\b/g)]
    .map(m => parseInt(m[1], 10) * 60 + parseInt(m[2], 10)).filter(m => m < 24 * 60);
}
// The part of a time field that belongs to a day: "Wed 19:30 / Sun 08:00" → "Wed 19:30"
function timePart(c, day) {
  const parts = String(c.time).split('/');
  if (parts.length > 1) {
    const abbr = day.slice(0, 3).toLowerCase();
    const hit = parts.find(p => new RegExp('\\b' + abbr).test(p.toLowerCase()));
    if (hit) return hit;
  }
  return String(c.time);
}
// Minutes after midnight of the first clock time ("Gather 8:45, start 9:30" → 8:45), or null for "Morning", "various".
function sessionMinutes(c, day) { const t = clockTimes(timePart(c, day)); return t.length ? t[0] : null; }
// End of the session: the second time of a range like "19:00–21:00", otherwise one hour.
function sessionEnd(c, day, start) {
  const m = timePart(c, day).match(/(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/);
  if (m) { const end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10); if (end > start) return end; }
  return start + 60;
}
// Label for a session with no clock time: the Sheet's own short wording ("Morning", "various"), else its bucket
function timeWord(c, day) {
  const raw = (day ? timePart(c, day) : c.time).trim();
  const word = raw && raw.length <= 10 ? raw : c.timeFilter.length === 1 ? c.timeFilter[0] : 'Varies';
  return word[0].toUpperCase() + word.slice(1);
}
function factsText(c) {
  const a = c.distText.trim(), b = c.paceText.trim();
  return a && b && !a.toLowerCase().includes(c.pace.trim().toLowerCase()) ? a + ', ' + b : a || b;
}
function fmt(min) { return Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0'); }
function fmtDur(min) {
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60), m = min % 60;
  return h + ' h' + (m ? ' ' + m + ' min' : '');
}

/* ── Clock: everything runs on Prague time, whatever the phone says ─── */
const pragueFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
function pragueParts(date) {
  const o = {};
  for (const p of pragueFmt.formatToParts(date)) if (p.type !== 'literal') o[p.type] = +p.value;
  o.hour %= 24;
  return o;
}
function pragueOffsetMin(ms) {
  const p = pragueParts(new Date(ms));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ms) / 60000);
}
function refreshClock() {
  const p = pragueParts(new Date());
  const base = Date.UTC(p.year, p.month - 1, p.day);
  const dayChanged = !T || T.base !== base;
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base + i * 864e5);
    week.push({ i, ms: +d, name: DAYS[(d.getUTCDay() + 6) % 7], num: d.getUTCDate(), iso: d.toISOString().slice(0, 10) });
  }
  T = { now: p.hour * 60 + p.minute, base, week };
  return dayChanged;
}
function dateLabel(ms, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(ms).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });
}

/* ── Sun: sunrise and sunset in Prague, in minutes after local midnight ─ */
const sunCache = new Map();
function sun(dayMs) {
  if (sunCache.has(dayMs)) return sunCache.get(dayMs);
  const rad = Math.PI / 180, lat = PRAGUE.lat, lngHour = PRAGUE.lng / 15;
  const d = new Date(dayMs);
  const N = Math.round((dayMs - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5);
  const offset = pragueOffsetMin(dayMs + 12 * 36e5);
  const calc = rising => {
    const t = N + ((rising ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = (M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634) % 360; if (L < 0) L += 360;
    let RA = (Math.atan(0.91764 * Math.tan(L * rad)) / rad) % 360; if (RA < 0) RA += 360;
    RA = (RA + Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90) / 15;
    const sinDec = 0.39782 * Math.sin(L * rad), cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    const H = (rising ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad) / 15;
    let UT = (H + RA - 0.06571 * t - 6.622 - lngHour) % 24; if (UT < 0) UT += 24;
    return Math.round(UT * 60 + offset);
  };
  const out = { rise: calc(true), set: calc(false) };
  sunCache.set(dayMs, out);
  return out;
}
function isDark(dayMs, min) { const s = sun(dayMs); return min >= s.set + 10 || min < s.rise - 10; }

/* ── Weather (Open-Meteo, optional; the app works without it) ───────── */
async function loadWeather() {
  const cached = read(WX_KEY);
  if (cached && Date.now() - cached.at < 6 * 36e5) S.wx = cached.h;
  if (cached && Date.now() - cached.at < 36e5) return;
  try {
    const res = await fetch(WEATHER_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const h = {};
    j.hourly.time.forEach((t, i) => { h[t] = [j.hourly.temperature_2m[i], j.hourly.precipitation_probability[i], j.hourly.weather_code[i]]; });
    S.wx = h;
    store(WX_KEY, { at: Date.now(), h });
    renderAll();
  } catch (err) { /* forecast is a nice-to-have */ }
}
function wxText(iso, min) {
  const hour = String(Math.min(23, Math.round(min / 60))).padStart(2, '0');
  const v = S.wx && S.wx[iso + 'T' + hour + ':00'];
  if (!v || v[0] == null) return '';
  const snow = (v[2] >= 71 && v[2] <= 77) || v[2] === 85 || v[2] === 86;
  const what = snow ? 'snow' : 'rain';
  const sky = v[1] >= 60 ? what + ' likely' : v[1] >= 30 ? 'chance of ' + what : 'dry';
  return Math.round(v[0]) + '°, ' + sky;
}

/* ── Data ───────────────────────────────────────────────────────────── */
function normalizeClub(raw) {
  const c = {
    ...raw,
    name: String(raw.name ?? ''), category: String(raw.category ?? ''), time: String(raw.time ?? ''),
    distText: String(raw.distText ?? ''), pace: String(raw.pace ?? ''), meet: String(raw.meet ?? ''), desc: String(raw.desc ?? ''),
    days: toArray(raw.days), timeFilter: toArray(raw.timeFilter), distFilter: toArray(raw.distFilter),
    lat: Number(raw.lat), lng: Number(raw.lng), free: raw.free === true || String(raw.free).toLowerCase() === 'true',
    link: safeUrl(raw.link),
  };
  c.base = baseName(c.name);
  c.sub = c.name.slice(c.base.length).replace(/^\s*[—–]\s*/, '').trim();
  c.key = c.base.toLowerCase();
  c.ini = getInitials(c.name);
  c.hasGeo = Number.isFinite(c.lat) && Number.isFinite(c.lng);
  c.vibes = VIBES.filter(([, test]) => test(c)).map(([name]) => name);
  const pace = c.pace.trim();
  c.paceText = /\d:\d\d/.test(pace) ? pace + ' min/km' : ({ varied: 'mixed pace', social: 'social pace', easy: 'easy pace' })[pace.toLowerCase()] || pace;
  c.hay = (c.name + ' ' + c.meet + ' ' + c.category + ' ' + c.desc).toLowerCase();
  return c;
}

function setClubs(raw, source, savedAt) {
  S.source = source; S.savedAt = savedAt; S.loading = false;
  const json = JSON.stringify(raw);
  if (json === S.rawJson) { renderStatus(); renderAbout(); return; }
  S.rawJson = json;
  S.clubs = raw.map(normalizeClub).filter(c => c.name);
  S.byId = new Map(S.clubs.map(c => [c.id, c]));
  S.sessions = []; S.floating = [];
  S.byDay = Object.fromEntries(DAYS.map(d => [d, []]));
  for (const c of S.clubs) {
    if (daysVary(c)) { S.floating.push(c); continue; }
    for (const day of c.days) {
      if (!DAYS.includes(day)) continue;
      const start = sessionMinutes(c, day);
      const s = { c, day, start, end: start == null ? null : sessionEnd(c, day, start) };
      S.sessions.push(s); S.byDay[day].push(s);
    }
  }
  for (const d of DAYS) S.byDay[d].sort((a, b) => (a.start ?? 1e4) - (b.start ?? 1e4) || a.c.name.localeCompare(b.c.name));
  if (S.sel && !S.byId.has(S.sel.id)) closeDetail({ silent: true });
  buildPins();
  renderAll();
  if (onFirstData) { const fn = onFirstData; onFirstData = null; fn(); }
  if (S.sel) renderDetail();
  if (S.finder) renderFinder();
  if (!S.sel) fitToDay(false);
}

async function fetchClubs(attempt = 1) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(SCRIPT_URL, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error('Empty payload');
    return data;
  } catch (err) {
    if (attempt < 2 && navigator.onLine !== false) {
      await new Promise(r => setTimeout(r, 800));
      return fetchClubs(attempt + 1);
    }
    throw err;
  } finally { clearTimeout(timer); }
}

// Show the copy saved on this device straight away, then swap in live data when it arrives.
let lastFetch = 0, fetching = false, onFirstData = null;
async function loadData(manual) {
  if (fetching) return;
  fetching = true;
  const saved = read(SAVED_KEY);
  const hasSaved = saved && Array.isArray(saved.clubs) && saved.clubs.length;
  if (hasSaved && !S.clubs.length) setClubs(saved.clubs, 'saved-pending', saved.savedAt);
  else if (!S.clubs.length) {
    // Brand-new device: show the snapshot shipped with the app while the live list loads
    try {
      const snap = await (await fetch(SNAPSHOT_URL)).json();
      if (!S.clubs.length && Array.isArray(snap.clubs) && snap.clubs.length) setClubs(snap.clubs, 'saved-pending', snap.savedAt);
    } catch { renderAll(); }
  }
  try {
    const live = await fetchClubs();
    lastFetch = Date.now();
    store(SAVED_KEY, { savedAt: lastFetch, clubs: live });
    setClubs(live, 'live', lastFetch);
    if (manual) toast('Clubs are up to date');
  } catch (err) {
    console.warn('Live club data unavailable:', err.message);
    if (S.clubs.length) { S.source = 'saved'; renderStatus(); renderAbout(); }
    else { S.loading = false; S.source = 'none'; renderAll(); }
    if (manual) toast("Couldn't reach the club list. Showing the saved copy.");
  } finally { fetching = false; }
}

/* ── Filters ────────────────────────────────────────────────────────── */
const FILTER_GROUPS = [
  { key: 'tod', label: 'Time of day', options: () => TIMEOFDAY },
  { key: 'dist', label: 'Distance', options: () => DISTANCES },
  { key: 'pace', label: 'Pace', hint: 'min/km', options: () => PACES },
  { key: 'vibe', label: 'Vibe', options: () => VIBES.map(v => v[0]).filter(v => S.clubs.some(c => c.vibes.includes(v))) },
  { key: 'cat', label: 'Run by', options: () => [...new Set(S.clubs.map(c => c.category).filter(Boolean))] },
];
function filterCount() {
  const f = S.f;
  return f.tod.size + f.dist.size + f.pace.size + f.vibe.size + f.cat.size + (f.free ? 1 : 0) + (f.saved ? 1 : 0);
}
function clubBaseMatch(c) {
  const f = S.f;
  if (f.dist.size && !c.distFilter.some(x => f.dist.has(x))) return false;
  if (f.pace.size && ![...f.pace].some(p => paceMatch(c.pace, p))) return false;
  if (f.vibe.size && ![...f.vibe].every(v => c.vibes.includes(v))) return false;
  if (f.cat.size && !f.cat.has(c.category)) return false;
  if (f.free && !c.free) return false;
  if (f.saved && !S.saved.has(c.id)) return false;
  return true;
}
// Time of day for one session. The Sheet's own bucket wins; a row with several
// buckets and per-day times ("Wed 19:30 / Sun 08:00") is split by its clock time.
function todOf(s) {
  const tf = s.c.timeFilter;
  if (tf.length <= 1 || s.start == null) return tf;
  const b = s.start < 720 ? 'Morning' : s.start <= 1020 ? 'Afternoon' : 'Evening';
  return tf.includes(b) ? [b] : tf;
}
function sessionMatches(s) {
  if (!clubBaseMatch(s.c)) return false;
  return !S.f.tod.size || todOf(s).some(x => S.f.tod.has(x));
}
function clubMatches(c) {
  if (!clubBaseMatch(c)) return false;
  if (!S.f.tod.size) return true;
  const own = S.sessions.filter(s => s.c === c);
  return own.length ? own.some(s => todOf(s).some(x => S.f.tod.has(x))) : c.timeFilter.some(x => S.f.tod.has(x));
}
function matchingRunCount() {
  return S.sessions.filter(sessionMatches).length + S.floating.filter(clubMatches).length;
}

/* ── Session status and next occurrence ─────────────────────────────── */
// 'up' | 'soon' | 'live' | 'past' | 'unknown' for a session on day index i of the rolling week
function statusOf(s, i) {
  if (i !== 0) return 'up';
  if (s.start == null) return 'unknown';
  if (T.now < s.start) return s.start - T.now <= SOON_MIN ? 'soon' : 'up';
  return T.now < s.end ? 'live' : 'past';
}
// Days from today (0–7) until a session next starts
function daysUntil(s) {
  const i = T.week.findIndex(d => d.name === s.day);
  if (i === 0 && s.start != null && T.now >= s.end) return 7;
  return i;
}
function nextSession(list) {
  let best = null;
  for (const s of list) {
    if (s.start == null) continue;
    let i = T.week.findIndex(d => d.name === s.day);
    if (i === 0 && T.now > s.start) i = 7;
    const at = i * 1440 + s.start;
    if (!best || at < best.at) best = { s, i, at };
  }
  return best;
}
function distanceTo(c) { return S.user && c.hasGeo ? haversine(S.user.lat, S.user.lng, c.lat, c.lng) : null; }
function awayText(c) { const d = distanceTo(c); return d == null ? '' : (d < 10 ? d.toFixed(1) : Math.round(d)) + ' km away'; }

/* ── Rendering ──────────────────────────────────────────────────────── */
function renderAll() {
  renderNext(); renderFind(); renderChips(); renderStatus(); renderAbout();
  if (S.view === 'day') renderDay();
  else if (S.view === 'week') renderWeek();
  else renderClubs();
  updatePins();
}

function renderNext() {
  const b = el.next;
  if (S.loading && !S.clubs.length) { b.className = 'next none'; b.innerHTML = '<span class="next-body"><span class="next-what">Loading clubs</span></span>'; return; }
  const filtered = filterCount() > 0;
  const n = nextSession(S.sessions.filter(sessionMatches));
  if (!n) {
    b.className = 'next none'; b.disabled = true;
    b.innerHTML = `<span class="next-body"><span class="next-what">${S.clubs.length ? (filtered ? 'No run with a fixed time matches your filters.' : 'No runs with a fixed time this week.') : "Couldn't load the clubs."}</span></span>`;
    return;
  }
  const what = filtered ? 'Next match' : 'Next run';
  const diff = n.s.start - T.now;
  const when = n.i === 0 ? (diff <= 0 ? what + ' starts now' : what + ' in ' + fmtDur(diff))
    : n.i === 1 ? what + ' tomorrow'
    : n.i === 7 ? what + ' next ' + n.s.day
    : what + ' on ' + n.s.day;
  b.disabled = false;
  b.className = 'next' + (n.i === 0 && diff <= SOON_MIN ? ' soon' : '');
  b.dataset.open = n.s.c.id; b.dataset.day = n.s.day;
  b.innerHTML = `<span class="next-time">${fmt(n.s.start)}</span>
    <span class="next-body"><span class="next-when">${esc(when)}</span>
    <span class="next-what"><b>${esc(n.s.c.base)}</b>, ${esc(n.s.c.meet)}</span></span>`;
}

function renderFind() {
  const n = filterCount();
  el.btnFind.classList.toggle('on', n > 0);
  el.btnFind.innerHTML = ICON.sliders + '<span>Find my run</span>' + (n ? `<span class="n">${n}</span><span class="sr-only"> filters on</span>` : '');
}

function renderChips() {
  const f = S.f, chips = [];
  for (const g of FILTER_GROUPS) for (const v of f[g.key]) chips.push([g.key, v, v]);
  if (f.free) chips.push(['free', '1', 'Free to join']);
  if (f.saved) chips.push(['saved', '1', 'Saved clubs']);
  el.chips.hidden = !chips.length;
  el.chips.innerHTML = chips.map(([k, v, label]) =>
    `<button type="button" class="chip" data-unfilter="${esc(k)}" data-v="${esc(v)}" aria-label="Remove filter ${esc(label)}">${esc(label)}${ICON.x}</button>`).join('') +
    (chips.length > 1 ? '<button type="button" class="chip clear" data-act="clear-filters">Clear all</button>' : '');
}

function renderStatus() {
  const off = S.source === 'saved';
  el.status.hidden = !off;
  if (off) {
    el.status.innerHTML = `<span>${navigator.onLine === false ? 'Offline.' : "Couldn't reach the club list."} Showing the copy saved on ${esc(dateLabel(S.savedAt + pragueOffsetMin(S.savedAt) * 60000, { day: 'numeric', month: 'long' }))}.</span>
      <button type="button" class="link" data-act="refresh">Retry</button>`;
  }
}

function rowHtml(s, i, opt = {}) {
  const c = s.c, st = opt.plain ? 'up' : statusOf(s, i);
  const extra = [];
  if (st === 'soon') extra.push(`<span class="in">in ${fmtDur(s.start - T.now)}</span>`);
  if (st === 'live') extra.push(`<span class="in">started ${fmtDur(Math.max(1, T.now - s.start))} ago</span>`);
  extra.push(`<span>${esc(factsText(c))}</span>`);
  if (!c.free) extra.push('<span class="tag">Paid</span>');
  if (s.start != null && i != null && isDark(T.week[i % 7].ms + (i >= 7 ? 7 * 864e5 : 0), s.start)) extra.push(`${ICON.moon}<span class="sr-only">after dark</span>`);
  const away = awayText(c); if (away) extra.push(`<span>${away}</span>`);
  const time = s.start != null ? `<span class="row-t">${fmt(s.start)}</span>`
    : `<span class="row-t word">${esc(timeWord(c, s.day))}</span>`;
  const name = opt.sibling ? esc(c.sub || c.name) : esc(c.base) + (c.sub ? ` <span class="row-s">${esc(c.sub)}</span>` : '');
  const where = opt.sibling && s.day ? s.day + ', ' + c.meet : c.meet;
  const sel = S.sel && S.sel.id === c.id ? ' sel' : '';
  return `<button type="button" class="row ${st}${sel}" data-open="${esc(c.id)}"${s.day ? ` data-day="${s.day}"` : ''}>
    ${time}
    <span class="row-b">
      <span class="row-n">${name}${S.saved.has(c.id) ? ICON.starSm : ''}</span>
      <span class="row-m">${esc(where)}</span>
      <span class="row-x">${extra.join('')}</span>
    </span></button>`;
}

function renderDay() {
  const day = T.week[S.dayIdx];
  const counts = T.week.map(d => S.byDay[d.name] ? S.byDay[d.name].filter(sessionMatches).length : 0);
  const max = Math.max(1, ...counts);
  el.days.innerHTML = T.week.map((d, i) => `
     <button type="button" class="day${counts[i] ? '' : ' is-empty'}" data-day-idx="${i}" aria-pressed="${i === S.dayIdx}"
      aria-label="${i === 0 ? 'Today, ' : ''}${esc(dateLabel(d.ms, { weekday: 'long', day: 'numeric', month: 'long' }))}, ${plural(counts[i], 'run')}">
      <span class="day-w">${i === 0 ? 'Today' : d.name.slice(0, 3)}</span>
      <span class="day-n">${d.num}</span>
      <span class="day-load"><i style="width:${Math.round(counts[i] / max * 100)}%"></i></span>
    </button>`).join('');

  if (S.loading && !S.clubs.length) { el.dayMeta.textContent = ''; el.dayList.innerHTML = '<div class="skel"><i></i><i></i><i></i><i></i></div>'; return; }
  if (!S.clubs.length) {
    el.dayMeta.textContent = '';
    el.dayList.innerHTML = `<div class="empty"><strong>Couldn't load the clubs</strong><span>Check your connection and try again.</span><button type="button" class="btn primary" data-act="refresh">Try again</button></div>`;
    return;
  }

  const list = S.byDay[day.name].filter(sessionMatches);
  const timed = list.filter(s => s.start != null);
  const meta = ['Sunset at ' + fmt(sun(day.ms).set) + '.'];
  if (timed.length) {
    const mid = timed[Math.floor((timed.length - 1) / 2)].start;
    const wx = wxText(day.iso, mid);
    if (wx) meta.push('Forecast for ' + fmt(mid) + ': ' + wx + '.');
  }
  el.dayMeta.textContent = meta.join(' ');

  const now = [], past = [];
  for (const s of list) (statusOf(s, S.dayIdx) === 'past' ? past : now).push(s);
  const floating = S.floating.filter(clubMatches);
  let html = now.map(s => rowHtml(s, S.dayIdx)).join('');
  if (past.length) html += `<div class="divider">Earlier today</div>` + past.map(s => rowHtml(s, S.dayIdx)).join('');
  if (floating.length) html += `<div class="divider">Day varies, check their page</div>` + floating.map(c => rowHtml({ c, day: null, start: null, end: null }, null, { plain: true })).join('');

  if (!list.length && !floating.length) {
    const dayName = S.dayIdx === 0 ? 'today' : 'on ' + day.name;
    const nextIdx = counts.findIndex((n, i) => i > S.dayIdx && n > 0);
    html = `<div class="empty"><strong>${filterCount() ? 'Nothing matches your filters ' + dayName : 'No runs ' + dayName}</strong>
      ${nextIdx > -1 ? `<button type="button" class="btn" data-day-idx="${nextIdx}">Show ${nextIdx === 1 ? 'tomorrow' : T.week[nextIdx].name}, ${plural(counts[nextIdx], 'run')}</button>` : ''}
      ${filterCount() ? '<button type="button" class="btn" data-act="clear-filters">Clear filters</button>' : ''}</div>`;
  } else if (!now.length && past.length && S.dayIdx === 0) {
    const nextIdx = counts.findIndex((n, i) => i > 0 && n > 0);
    html = `<div class="empty"><strong>That's it for today</strong>
      ${nextIdx > -1 ? `<button type="button" class="btn" data-day-idx="${nextIdx}">Show ${nextIdx === 1 ? 'tomorrow' : T.week[nextIdx].name}, ${plural(counts[nextIdx], 'run')}</button>` : ''}</div>` + html;
  }
  el.dayList.innerHTML = html;
}

/* Week: seven lanes, one per day, every run placed by its start time */
function renderWeek() {
  if (!S.clubs.length) { el.lanes.innerHTML = ''; el.weekNote.innerHTML = ''; return; }
  const starts = S.sessions.filter(s => s.start != null).map(s => s.start);
  const t0 = Math.max(0, Math.floor((Math.min(...starts, 480) - 30) / 60) * 60);
  const t1 = Math.min(1440, Math.ceil((Math.max(...starts, 1200) + 45) / 60) * 60);
  const range = t1 - t0;
  const width = Math.max(180, (el.lanes.clientWidth || el.sheet.clientWidth) - 26 - 46 - 30);
  const pct = m => ((m - t0) / range * 100).toFixed(2) + '%';
  const ticks = [];
  for (let m = Math.ceil(t0 / 180) * 180; m <= t1; m += 180) if (m > t0 && m < t1) ticks.push(m);
  const tickLines = ticks.map(m => `<i class="tk" style="left:${pct(m)}"></i>`).join('');

  const counts = {};
  let html = `<div class="lane-axis"><span></span><div class="ticks">${ticks.map(m => `<span style="left:${pct(m)}">${m / 60}:00</span>`).join('')}</div><span class="any" title="No fixed time">any</span></div>`;
  for (const d of T.week) {
    const list = S.byDay[d.name];
    const rows = [], dots = [], anyDots = [];
    let anyN = 0;
    for (const s of list) {
      const match = sessionMatches(s);
      if (match) counts[d.name] = (counts[d.name] || 0) + 1;
      const st = statusOf(s, d.i);
      const cls = 'dot' + (match ? '' : ' dim') + (s.c.free ? '' : ' paid') + (st === 'past' ? ' gone' : '') + (st === 'soon' && match ? ' soon' : '');
      const label = `${s.start != null ? fmt(s.start) : timeWord(s.c, s.day)} ${s.c.name}`;
      const attrs = `data-open="${esc(s.c.id)}" data-day="${d.name}" title="${esc(label)}" aria-label="${esc(d.name + ' ' + label)}"`;
      if (s.start == null) { anyDots.push([cls, '50%', anyN++, attrs]); continue; }
      const x = (s.start - t0) / range * width;
      let r = rows.findIndex(last => x - last >= 13.5);
      if (r < 0) { r = rows.length; rows.push(x); } else rows[r] = x;
      dots.push([cls, pct(s.start), r, attrs]);
    }
    const stack = Math.max(rows.length, anyN, 1) * 15 - 3;
    const h = Math.max(46, stack + 22), top = (h - stack) / 2;
    const draw = list => list.map(([cls, left, r, attrs]) => `<button type="button" class="${cls}" style="left:${left};top:${(top + r * 15).toFixed(1)}px" ${attrs}></button>`).join('');
    html += `<div class="lane${d.i === 0 ? ' today' : ''}" style="height:${h}px">
      <button type="button" class="lane-day" data-day-idx="${d.i}" data-go="day" aria-label="Show ${d.name}"><b>${d.i === 0 ? 'Today' : d.name.slice(0, 3)}</b><span>${d.num} ${dateLabel(d.ms, { month: 'short' })}</span></button>
      <div class="lane-track">${tickLines}${d.i === 0 && T.now > t0 && T.now < t1 ? `<i class="lane-now" style="left:${pct(T.now)}"></i>` : ''}${draw(dots)}</div>
      <div class="lane-any">${draw(anyDots)}</div></div>`;
  }
  el.lanes.innerHTML = html;

  const ranked = DAYS.filter(d => counts[d]).sort((a, b) => counts[b] - counts[a]);
  const quiet = DAYS.filter(d => !counts[d]);
  const total = matchingRunCount();
  let note = '';
  if (!ranked.length) note = 'No runs match your filters.';
  else {
    note = `${plural(total, filterCount() ? 'matching run' : 'run')} a week. ${ranked[0]} is the busiest day with ${counts[ranked[0]]}.`;
    if (quiet.length && quiet.length < 4) note += ` Nothing on ${listText(quiet)}.`;
  }
  el.weekNote.innerHTML = `<span>${esc(note)}</span>
    <span class="week-key"><span><i class="dot"></i>free</span><span><i class="dot paid"></i>paid</span>${filterCount() ? '<span><i class="dot dim"></i>filtered out</span>' : ''}</span>`;
}

function clubGroups() {
  const groups = new Map();
  for (const c of S.clubs) {
    if (!groups.has(c.key)) groups.set(c.key, { key: c.key, base: c.base, rows: [] });
    groups.get(c.key).rows.push(c);
  }
  return [...groups.values()];
}
function renderClubs() {
  if (!S.clubs.length) { el.clubList.innerHTML = S.loading ? '<div class="skel"><i></i><i></i><i></i></div>' : ''; return; }
  const q = S.q.trim().toLowerCase();
  let groups = clubGroups().map(g => ({ ...g, rows: g.rows.filter(clubMatches) })).filter(g => g.rows.length);
  if (q) groups = groups.filter(g => g.rows.some(c => c.hay.includes(q)));
  for (const g of groups) {
    g.sessions = S.sessions.filter(s => g.rows.includes(s.c) && sessionMatches(s));
    g.away = S.user ? Math.min(...g.rows.map(c => distanceTo(c) ?? Infinity)) : null;
    const n = nextSession(g.sessions);
    g.open = n ? n.s : (g.sessions[0] || { c: g.rows[0], day: null });
  }
  groups.sort((a, b) => S.user ? a.away - b.away : a.base.localeCompare(b.base, 'en', { sensitivity: 'base' }));

  if (!groups.length) {
    el.clubList.innerHTML = `<div class="empty"><strong>${q ? 'No club matches “' + esc(S.q.trim()) + '”' : 'No club matches your filters'}</strong>
      ${filterCount() ? '<button type="button" class="btn" data-act="clear-filters">Clear filters</button>' : ''}</div>`;
    return;
  }
  el.clubList.innerHTML = groups.map(g => {
    const first = g.rows[0];
    const when = g.sessions.slice().sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || (a.start ?? 0) - (b.start ?? 0))
      .map(s => s.day.slice(0, 3) + ' ' + (s.start != null ? fmt(s.start) : timeWord(s.c, s.day).toLowerCase()));
    const whenText = when.length ? (when.length > 4 ? when.slice(0, 4).join(', ') + ' +' + (when.length - 4) : when.join(', ')) : 'Day varies';
    const allFree = g.rows.every(c => c.free), someFree = g.rows.some(c => c.free);
    const facts = [first.category, allFree ? 'free' : someFree ? 'some sessions paid' : 'paid'].filter(Boolean).join(', ');
    const away = g.away != null && Number.isFinite(g.away) ? (g.away < 10 ? g.away.toFixed(1) : Math.round(g.away)) + ' km away' : '';
    const saved = g.rows.some(c => S.saved.has(c.id));
    const sel = S.sel && g.rows.some(c => c.id === S.sel.id) ? ' sel' : '';
    return `<button type="button" class="club${sel}" data-open="${esc(g.open.c.id)}"${g.open.day ? ` data-day="${g.open.day}"` : ''}>
      <span class="ava${first.ini.length > 3 ? ' long' : ''}" aria-hidden="true">${esc(first.ini)}</span>
      <span class="row-b">
        <span class="row-n">${esc(g.base)}${saved ? ICON.starSm : ''}</span>
        <span class="row-m">${esc(whenText)}</span>
        <span class="row-x"><span>${esc(facts)}</span>${away ? `<span>${away}</span>` : ''}</span>
      </span></button>`;
  }).join('');
}

function renderAbout() {
  if (!S.clubs.length) { $('aboutStats').textContent = ''; $('aboutData').textContent = S.loading ? 'Loading clubs.' : 'No club data yet.'; return; }
  const clubs = new Set(S.clubs.map(c => c.key)).size;
  const free = clubGroups().filter(g => g.rows.some(c => c.free)).length;
  $('aboutStats').textContent = `${plural(clubs, 'club')}, ${plural(S.sessions.length + S.floating.length, 'run')} a week, ${free} free to join.`;
  const when = dateLabel(S.savedAt + pragueOffsetMin(S.savedAt) * 60000, { day: 'numeric', month: 'long' });
  $('aboutData').textContent = S.source === 'live' ? 'Club list is up to date.'
    : S.source === 'saved-pending' ? 'Checking for updates.'
    : `Offline copy from ${when}.`;
}

/* ── Detail ─────────────────────────────────────────────────────────── */
function everyText(c) {
  const days = c.days.filter(d => DAYS.includes(d));
  if (!days.length) return 'Day varies';
  if (days.length === 1) return 'Every ' + days[0];
  return listText(days.map(d => d + 's'));
}
function linkLabel(url) {
  const host = url ? new URL(url).hostname.replace(/^www\./, '') : '';
  if (host.includes('instagram')) return 'Instagram';
  if (host.includes('meetup')) return 'Meetup';
  if (host.includes('facebook')) return 'Facebook';
  return 'Website';
}
function focusSession(c, day) {
  const own = S.sessions.filter(s => s.c === c);
  if (!own.length) return null;
  return own.find(s => s.day === day) || (nextSession(own) || {}).s || own[0];
}

function renderDetail() {
  const c = S.byId.get(S.sel.id);
  if (!c) return;
  const f = focusSession(c, S.sel.day);
  const saved = S.saved.has(c.id);
  const plainTime = /^\s*\d{1,2}[:.]\d{2}\s*$/.test(c.time);

  let nextLine = '', note = '';
  if (f) {
    const i = daysUntil(f), dayMs = T.base + i * 864e5, iso = new Date(dayMs).toISOString().slice(0, 10);
    const st = statusOf(f, i);
    const label = i === 0 ? 'today' : i === 1 ? 'tomorrow' : dateLabel(dayMs, { weekday: 'long', day: 'numeric', month: 'short' });
    const bits = ['Next: ' + label + (st === 'soon' ? `, <span class="in">in ${fmtDur(f.start - T.now)}</span>` : st === 'live' ? `, <span class="in">started ${fmtDur(Math.max(1, T.now - f.start))} ago</span>` : '') + '.'];
    if (f.start != null) {
      const wx = wxText(iso, f.start);
      if (wx) bits.push('Forecast: ' + esc(wx) + '.');
      const sn = sun(dayMs);
      if (f.start >= sn.set) note = `Sunset is at ${fmt(sn.set)}, so this one runs in the dark. Bring a light.`;
      else if (f.start < sn.rise) note = `Starts before sunrise at ${fmt(sn.rise)}. Bring a light.`;
      else if (f.end > sn.set) note = `Sunset is at ${fmt(sn.set)}, so you will finish in the dark.`;
    }
    nextLine = bits.join(' ');
  }
  const canCal = S.sessions.some(s => s.c === c && s.start != null);
  const siblings = S.sessions.filter(s => s.c.key === c.key && s.c !== c);
  const away = awayText(c);
  const hasDir = c.hasGeo, hasLink = !!c.link;

  el.detail.innerHTML = `
    <div class="pane-head" data-drag>
      <span class="grab-mark" aria-hidden="true"></span>
      <button type="button" class="ibtn flat" data-act="close-detail" aria-label="Back to the list">${ICON.back}</button>
      <span class="sp"></span>
      <button type="button" class="ibtn flat" data-act="save" aria-pressed="${saved}" aria-label="${saved ? 'Remove from saved clubs' : 'Save this club'}">${saved ? ICON.starOn : ICON.star}</button>
      <button type="button" class="ibtn flat" data-act="share" aria-label="Share this run">${ICON.share}</button>
    </div>
    <div class="pane-body scrollable">
      <h2 class="d-name" id="dName">${esc(c.base)}</h2>
      <p class="d-sub">${esc([c.sub, [c.category, c.free ? 'free to join' : 'paid or members only'].filter(Boolean).join(', ')].filter(Boolean).join('. '))}</p>

      <div class="d-when">
        <span class="d-time${f && f.start != null ? '' : ' word'}">${f && f.start != null ? fmt(f.start) : esc(timeWord(c, f && f.day))}</span>
        <span>
          <span class="d-days">${esc(everyText(c))}</span>
          ${!plainTime && f && f.start != null ? `<div class="d-nextrun">${esc(c.time)}</div>` : ''}
          ${nextLine ? `<div class="d-nextrun">${nextLine}</div>` : ''}
        </span>
      </div>
      ${note ? `<p class="d-note">${ICON.moonLg}<span>${esc(note)}</span></p>` : ''}

      <div class="d-actions">
        ${canCal ? `<button type="button" class="btn primary" data-act="cal" aria-expanded="false" aria-controls="calMenu">${ICON.cal}Add to calendar</button>
        <div class="cal-menu" id="calMenu" hidden>
          <button type="button" class="btn" data-act="ics">Apple or Outlook</button>
          <a class="btn" href="${esc(googleCalUrl(c, f))}" target="_blank" rel="noopener">Google Calendar</a>
        </div>` : ''}
        ${hasDir ? `<a class="btn${hasLink ? '' : ' solo'}" href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}" target="_blank" rel="noopener">${ICON.dir}Directions</a>` : ''}
        ${hasLink ? `<a class="btn${hasDir ? '' : ' solo'}" href="${esc(c.link)}" target="_blank" rel="noopener">${ICON.ext}${linkLabel(c.link)}</a>` : ''}
      </div>

      <dl class="d-facts">
        <dt>Meet at</dt><dd>${esc(c.meet)}${away ? ', ' + away : ''}</dd>
        <dt>Distance</dt><dd>${esc(c.distText)}</dd>
        <dt>Pace</dt><dd>${esc(c.paceText)}</dd>
        <dt>Entry</dt><dd>${c.free ? 'Free, just show up' : 'Paid or membership'}</dd>
      </dl>
      ${c.desc ? `<p class="d-desc">${esc(c.desc)}</p>` : ''}
      ${c.vibes.length ? `<div class="d-vibes">${c.vibes.map(v => `<span>${esc(v)}</span>`).join('')}</div>` : ''}
      ${siblings.length ? `<div class="d-more"><h3>More from ${esc(c.base)}</h3>${siblings.map(s => rowHtml(s, null, { plain: true, sibling: true })).join('')}</div>` : ''}
    </div>`;
}

function openDetail(id, day, opts = {}) {
  const c = S.byId.get(id);
  if (!c) return;
  const wasOpen = !!S.sel;
  if (!wasOpen) {
    S.prev = { snap: S.snap, focus: document.activeElement, cam: map && mapReady ? { center: map.getCenter(), zoom: map.getZoom() } : null };
  }
  S.sel = { id, day: day || null };
  if (!opts.fromHistory) {
    const st = { run: id, day: day || null };
    if (wasOpen) history.replaceState(st, '', '#run-' + id); else history.pushState(st, '', '#run-' + id);
  }
  renderDetail();
  el.detail.hidden = false;
  if (wasOpen) { el.detail.style.animation = 'none'; el.detail.offsetWidth; el.detail.style.animation = ''; }
  markSelected();
  updatePins();
  if (!desk.matches && S.snap !== 'half') setSnap('half');
  flyToClub(c);
  const back = el.detail.querySelector('[data-act="close-detail"]');
  if (back) back.focus({ preventScroll: true });
}

function closeDetail(opts = {}) {
  if (!S.sel) return;
  if (!opts.fromHistory && !opts.silent && history.state && history.state.run != null) { history.back(); return; }
  const prev = S.prev || {};
  S.sel = null; S.prev = null;
  el.detail.hidden = true;
  el.detail.innerHTML = '';
  markSelected();
  updatePins();
  if (!desk.matches && prev.snap && prev.snap !== S.snap) setSnap(prev.snap);
  if (map && mapReady && prev.cam) moveCamera({ center: prev.cam.center, zoom: prev.cam.zoom, pitch: 0, bearing: 0 }, 900, false);
  if (prev.focus && prev.focus.isConnected) prev.focus.focus({ preventScroll: true });
}
function markSelected() {
  el.sheet.querySelectorAll('.row.sel, .club.sel').forEach(n => n.classList.remove('sel'));
  if (!S.sel) return;
  el.scroll.querySelectorAll(`[data-open="${CSS.escape(String(S.sel.id))}"]`).forEach(n => { if (n.matches('.row, .club')) n.classList.add('sel'); });
}

function toggleSave() {
  const id = S.sel.id;
  if (S.saved.has(id)) S.saved.delete(id); else S.saved.add(id);
  S.prefs.saved = [...S.saved];
  store(PREFS_KEY, S.prefs);
  toast(S.saved.has(id) ? 'Saved' : 'Removed from saved');
  renderDetail(); renderAll(); markSelected();
  el.detail.querySelector('[data-act="save"]').focus({ preventScroll: true });
}

async function shareRun() {
  const c = S.byId.get(S.sel.id);
  const url = location.origin + '/#run-' + c.id;
  const f = focusSession(c, S.sel.day);
  const text = `${c.name}${f ? ', ' + f.day + (f.start != null ? ' ' + fmt(f.start) : '') : ''}, ${c.meet}`;
  if (navigator.share) { try { await navigator.share({ title: c.name, text, url }); } catch {} return; }
  try { await navigator.clipboard.writeText(text + '\n' + url); toast('Link copied'); }
  catch { toast("Couldn't copy the link"); }
}

/* ── Calendar export ────────────────────────────────────────────────── */
const BYDAY = { Monday: 'MO', Tuesday: 'TU', Wednesday: 'WE', Thursday: 'TH', Friday: 'FR', Saturday: 'SA', Sunday: 'SU' };
function icsStamp(dayMs, min) {
  const d = new Date(dayMs);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}T${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}00`;
}
// Sessions of one row that share a start and end become one weekly event.
function calendarGroups(c) {
  const groups = new Map();
  for (const s of S.sessions) {
    if (s.c !== c || s.start == null) continue;
    const k = s.start + '-' + s.end;
    if (!groups.has(k)) groups.set(k, { start: s.start, end: s.end, sessions: [] });
    groups.get(k).sessions.push(s);
  }
  return [...groups.values()].map(g => {
    const first = g.sessions.map(s => ({ s, i: daysUntil(s) })).sort((a, b) => a.i - b.i)[0];
    return { ...g, days: g.sessions.map(s => BYDAY[s.day]), firstMs: T.base + first.i * 864e5 };
  });
}
function calDescription(c) {
  return [c.desc, factsText(c), c.free ? 'Free to join.' : 'Paid or membership.', c.link].filter(Boolean).join('\n');
}
function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function icsFold(line) {                          // 75 octets per line, continuation lines start with a space
  const enc = new TextEncoder();
  let out = '', cur = '', bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > 73) { out += cur + '\r\n '; cur = ''; bytes = 1; }
    cur += ch; bytes += n;
  }
  return out + cur;
}
function buildIcs(c) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Prague Run Clubs//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Prague',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const g of calendarGroups(c)) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:prc-${c.id}-${g.days.join('')}-${g.start}@praguerunclubs.vercel.app`,
      'DTSTAMP:' + now,
      'DTSTART;TZID=Europe/Prague:' + icsStamp(g.firstMs, g.start),
      'DTEND;TZID=Europe/Prague:' + icsStamp(g.firstMs, g.end),
      'RRULE:FREQ=WEEKLY;BYDAY=' + g.days.join(','),
      'SUMMARY:' + icsEscape(c.name),
      'LOCATION:' + icsEscape(c.meet),
      'DESCRIPTION:' + icsEscape(calDescription(c)),
    );
    if (c.hasGeo) lines.push(`GEO:${c.lat.toFixed(6)};${c.lng.toFixed(6)}`);
    if (c.link) lines.push('URL:' + c.link);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
function googleCalUrl(c, f) {
  const groups = calendarGroups(c);
  if (!groups.length) return '#';
  const g = (f && groups.find(x => x.sessions.includes(f))) || groups[0];
  const p = new URLSearchParams({
    action: 'TEMPLATE', text: c.name,
    dates: icsStamp(g.firstMs, g.start) + '/' + icsStamp(g.firstMs, g.end),
    ctz: 'Europe/Prague', recur: 'RRULE:FREQ=WEEKLY;BYDAY=' + g.days.join(','),
    location: c.meet, details: calDescription(c),
  });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
function downloadIcs() {
  const c = S.byId.get(S.sel.id);
  const text = buildIcs(c);
  const name = c.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.ics';
  if (isIOS) {
    // iPhone: a home-screen app can't download files, so hand the event to the share sheet
    try {
      const file = new File([text], name, { type: 'text/calendar' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file] }).catch(() => {}); return; }
    } catch {}
    const link = document.createElement('a');
    link.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(text); link.target = '_blank'; link.rel = 'noopener';
    document.body.appendChild(link); link.click(); link.remove();
    return;
  }
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ── Find my run ────────────────────────────────────────────────────── */
function renderFinder() {
  const f = S.f;
  const groups = FILTER_GROUPS.map(g => {
    const opts = g.options();
    if (!opts.length) return '';
    return `<div class="f-group"><h3 id="fg-${g.key}">${g.label}${g.hint ? ` <small>(${g.hint})</small>` : ''}</h3>
      <div class="opts" role="group" aria-labelledby="fg-${g.key}">${opts.map(o =>
        `<button type="button" class="opt" data-filter="${g.key}" data-v="${esc(o)}" aria-pressed="${f[g.key].has(o)}">${esc(o)}</button>`).join('')}</div></div>`;
  }).join('');
  el.finder.innerHTML = `
    <div class="pane-head" data-drag>
      <span class="grab-mark" aria-hidden="true"></span>
      <h2 class="f-title" id="finderTitle">Find my run</h2>
      <span class="sp"></span>
      <button type="button" class="ibtn flat" data-act="close-finder" aria-label="Close">${ICON.close}</button>
    </div>
    <div class="pane-body scrollable">
      ${groups}
      <div class="f-group"><h3 id="fg-only">Only show</h3>
        <div class="opts" role="group" aria-labelledby="fg-only">
          <button type="button" class="opt" data-filter="free" aria-pressed="${f.free}">Free to join</button>
          <button type="button" class="opt" data-filter="saved" aria-pressed="${f.saved}">Saved clubs</button>
        </div></div>
    </div>
    <div class="f-foot">
      <button type="button" class="btn" data-act="clear-filters">Reset</button>
      <button type="button" class="btn primary" data-act="close-finder" id="finderShow"></button>
    </div>`;
  updateFinderCount();
}
function updateFinderCount() {
  const b = $('finderShow');
  if (!b) return;
  const n = matchingRunCount();
  b.textContent = n ? 'Show ' + plural(n, 'run') : 'No runs match';
  b.disabled = !n;
  el.finder.querySelectorAll('.opt').forEach(o => {
    const k = o.dataset.filter;
    o.setAttribute('aria-pressed', k === 'free' || k === 'saved' ? S.f[k] : S.f[k].has(o.dataset.v));
  });
}
function openFinder(opts = {}) {
  if (S.finder) return;
  S.finder = true;
  S.prevSnap = S.snap;
  if (!opts.fromHistory) history.pushState({ finder: 1 }, '');
  renderFinder();
  el.finder.hidden = false;
  if (!desk.matches) setSnap('full');
  el.finder.querySelector('[data-act="close-finder"]').focus({ preventScroll: true });
}
function closeFinder(opts = {}) {
  if (!S.finder) return;
  if (!opts.fromHistory && history.state && history.state.finder) { history.back(); return; }
  S.finder = false;
  el.finder.hidden = true; el.finder.innerHTML = '';
  if (!desk.matches && S.prevSnap === 'peek') setSnap('half');
  el.btnFind.focus({ preventScroll: true });
  fitToDay(true);
}
function toggleFilter(key, value) {
  if (key === 'free' || key === 'saved') S.f[key] = !S.f[key];
  else if (S.f[key].has(value)) S.f[key].delete(value); else S.f[key].add(value);
  renderAll(); updateFinderCount();
  if (!S.finder) fitToDay(true);
}
function clearFilters() {
  for (const g of FILTER_GROUPS) S.f[g.key].clear();
  S.f.free = false; S.f.saved = false;
  renderAll(); updateFinderCount();
  if (!S.finder) fitToDay(true);
}

/* ── Views ──────────────────────────────────────────────────────────── */
function setView(view) {
  S.view = view;
  for (const v of ['day', 'week', 'clubs']) {
    const on = v === view, tab = $('tab' + v[0].toUpperCase() + v.slice(1));
    $('view' + v[0].toUpperCase() + v.slice(1)).hidden = !on;
    tab.setAttribute('aria-selected', on); tab.tabIndex = on ? 0 : -1;
  }
  el.scroll.scrollTop = 0;
  renderAll(); markSelected();
  if (!desk.matches && S.snap === 'peek') setSnap('half');
}
function setDay(i, fit = true) {
  S.dayIdx = i;
  renderAll(); markSelected();
  if (fit && !S.sel) fitToDay(true);
}

/* ── Sheet: three positions on a phone, a docked panel on wide screens ─ */
function peekHeight() { return el.grab.offsetHeight + el.next.offsetHeight + el.safeProbe.offsetHeight; }
function visibleHeight(snap) {
  const h = el.sheet.offsetHeight;
  return snap === 'full' ? h : snap === 'half' ? Math.min(h, Math.round(window.innerHeight * HALF)) : peekHeight();
}
function setSnap(snap) {
  if (snap !== 'full') el.sheet.querySelectorAll('.scrollable').forEach(n => { n.scrollTop = 0; });
  S.snap = snap;
  el.sheet.dataset.snap = snap;
  S.y = Math.max(0, el.sheet.offsetHeight - visibleHeight(snap));
  el.sheet.style.setProperty('--y', S.y + 'px');
}
let drag = null, suppressClick = false;
function dragStart(y) { drag = { y0: y, base: S.y, cur: S.y, lastY: y, lastT: performance.now(), v: 0 }; el.sheet.classList.add('dragging'); }
function dragMove(y) {
  const max = el.sheet.offsetHeight - peekHeight();
  drag.cur = Math.min(max, Math.max(0, drag.base + (y - drag.y0)));
  const t = performance.now();
  if (t > drag.lastT) drag.v = 0.7 * ((y - drag.lastY) / (t - drag.lastT)) + 0.3 * drag.v;
  drag.lastY = y; drag.lastT = t;
  el.sheet.style.setProperty('--y', drag.cur + 'px');
}
function dragEnd() {
  if (!drag) return;
  el.sheet.classList.remove('dragging');
  const h = el.sheet.offsetHeight;
  const target = drag.cur + drag.v * 220;          // where the gesture is heading
  const snaps = ['full', 'half', 'peek'].map(s => [s, h - visibleHeight(s)]);
  snaps.sort((a, b) => Math.abs(a[1] - target) - Math.abs(b[1] - target));
  drag = null;
  setSnap(snaps[0][0]);
}
function initSheet() {
  // Header (and pane headers): drag with mouse or finger; a tap still clicks.
  let pd = null;
  el.sheet.addEventListener('pointerdown', e => {
    if (desk.matches || !e.isPrimary || e.button > 0) return;
    if (!e.target.closest('#sheetHead, [data-drag]')) return;
    pd = { y: e.clientY, id: e.pointerId, moved: false };
  });
  // move/up are tracked on the window: a mouse leaves the sheet as soon as it is dragged upwards
  window.addEventListener('pointermove', e => {
    if (!pd || e.pointerId !== pd.id) return;
    if (!pd.moved) {
      if (Math.abs(e.clientY - pd.y) < 6) return;
      pd.moved = true;
      try { el.sheet.setPointerCapture(pd.id); } catch {}
      dragStart(pd.y);
    }
    dragMove(e.clientY);
  });
  const up = e => {
    if (!pd || e.pointerId !== pd.id) return;
    if (pd.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 60); dragEnd(); }
    pd = null;
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  el.sheet.addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);

  // Content: scrolls when the sheet is fully open; otherwise a vertical swipe moves the sheet.
  let t0 = null;
  el.sheet.addEventListener('touchstart', e => {
    t0 = null;
    if (desk.matches || e.touches.length !== 1) return;
    const sc = e.target.closest('.scrollable');
    if (!sc) return;
    t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, sc, mode: null };
  }, { passive: true });
  el.sheet.addEventListener('touchmove', e => {
    if (!t0) return;
    const x = e.touches[0].clientX, y = e.touches[0].clientY, dx = x - t0.x, dy = y - t0.y;
    if (!t0.mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) > Math.abs(dy)) t0.mode = 'x';
      else if (S.snap !== 'full' || (t0.sc.scrollTop <= 0 && dy > 0)) { t0.mode = 'drag'; dragStart(t0.y); }
      else t0.mode = 'scroll';
    }
    if (t0.mode === 'drag') { if (e.cancelable) e.preventDefault(); dragMove(y); }
  }, { passive: false });
  const tend = () => { if (t0 && t0.mode === 'drag') { suppressClick = true; setTimeout(() => { suppressClick = false; }, 60); dragEnd(); } t0 = null; };
  el.sheet.addEventListener('touchend', tend);
  el.sheet.addEventListener('touchcancel', tend);

  // If anything scrolls the content while the sheet is half open (keyboard focus, find-in-page),
  // open the sheet fully so the content can be scrolled back.
  el.sheet.addEventListener('scroll', e => {
    if (!desk.matches && S.snap !== 'full' && !drag && e.target.scrollTop > 0) { S.snap = 'full'; setSnap('full'); }
  }, true);

  // Mouse wheel or trackpad on a half-open sheet opens it fully.
  el.sheet.addEventListener('wheel', e => { if (!desk.matches && S.snap !== 'full' && e.deltaY > 0) setSnap('full'); }, { passive: true });
  el.grab.addEventListener('click', () => setSnap(S.snap === 'full' ? 'half' : 'full'));

  const relayout = () => { setSnap(S.snap); if (S.view === 'week') renderWeek(); };
  window.addEventListener('resize', relayout);
  desk.addEventListener('change', () => { relayout(); if (map) { map.resize(); fitToDay(false); } });
  setSnap('half');
}

/* ── Map ────────────────────────────────────────────────────────────── */
function theme() { return document.documentElement.dataset.theme; }

function mapStyle(th) {
  const P = th === 'dark' ? {
    bg: '#0A1120', urban: '#0D1527', water: '#17407A', park: '#0F2B2A', wood: '#0D2725',
    r0: '#151F35', r1: '#1D2A46', r2: '#283A5C', r3: '#324872', path: '#3B5281', rail: '#1B2640',
    bldg: '#162238', label: '#8391B0', labelHi: '#C6D0E6', halo: '#0A1120', waterLabel: '#6FA4E6', parkLabel: '#55A595',
  } : {
    bg: '#E9EDF2', urban: '#E4E9F0', water: '#9CC2EC', park: '#CBE4D0', wood: '#BEDCC5',
    r0: '#F4F6F9', r1: '#FBFCFD', r2: '#FFFFFF', r3: '#FFFFFF', path: '#B3BDCC', rail: '#CDD4DF',
    bldg: '#D8DEE8', label: '#5B6780', labelHi: '#1D2A46', halo: '#F1F4F8', waterLabel: '#2E6BB3', parkLabel: '#2F7A5A',
  };
  const src = (layer) => ({ source: 'omt', 'source-layer': layer });
  const isLine = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
  const road = (id, classes, color, minzoom, w) => ({
    id, type: 'line', ...src('transportation'), minzoom,
    filter: ['all', isLine, ['match', ['get', 'class'], classes, true, false], ['!=', ['get', 'brunnel'], 'tunnel']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, w[0], 14, w[1], 18, w[2]] },
  });
  const label = (id, layer, extra) => ({
    id, type: 'symbol', ...src(layer), ...extra,
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 7, ...(extra.layout || {}) },
    paint: { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.4, ...(extra.paint || {}) },
  });
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: { omt: { type: 'vector', url: TILEJSON_URL } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': P.bg } },
      { id: 'urban', type: 'fill', ...src('landuse'), filter: ['match', ['get', 'class'], ['residential', 'commercial', 'retail', 'industrial'], true, false], paint: { 'fill-color': P.urban } },
      { id: 'green', type: 'fill', ...src('landcover'), filter: ['match', ['get', 'class'], ['wood', 'grass'], true, false], paint: { 'fill-color': ['match', ['get', 'class'], 'wood', P.wood, P.park] } },
      { id: 'green-use', type: 'fill', ...src('landuse'), filter: ['match', ['get', 'class'], ['cemetery', 'stadium', 'pitch', 'track', 'playground'], true, false], paint: { 'fill-color': P.park } },
      { id: 'park', type: 'fill', ...src('park'), paint: { 'fill-color': P.park, 'fill-opacity': 0.7 } },
      { id: 'waterway', type: 'line', ...src('waterway'), minzoom: 11, filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'line-color': P.water, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 0.6, 16, 4] } },
      { id: 'water', type: 'fill', ...src('water'), filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'fill-color': P.water } },
      { ...road('path', ['path', 'track'], P.path, 13, [0.3, 0.8, 2.4]), layout: { 'line-join': 'round' }, paint: { 'line-color': P.path, 'line-dasharray': [2, 1.5], 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 13, 0.5, 15, 1, 18, 2.4] } },
      road('rail', ['rail'], P.rail, 11, [0.5, 1, 2]),
      road('road-minor', ['minor', 'service'], P.r0, 12, [0.3, 1.6, 9]),
      road('road-mid', ['tertiary', 'secondary'], P.r1, 10, [0.6, 2.6, 14]),
      road('road-main', ['primary', 'trunk'], P.r2, 9, [1, 3.4, 18]),
      road('road-motorway', ['motorway'], P.r3, 9, [1.2, 3.8, 20]),
      { id: 'buildings', type: 'fill-extrusion', ...src('building'), minzoom: 14,
        paint: {
          'fill-extrusion-color': P.bldg,
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.6, 0.9],
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14.8, 0, 15.8, ['coalesce', ['get', 'render_height'], 8]],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14.8, 0, 15.8, ['coalesce', ['get', 'render_min_height'], 0]],
        } },
      label('river-label', 'waterway', { minzoom: 11, filter: ['==', ['get', 'class'], 'river'],
        layout: { 'symbol-placement': 'line', 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-letter-spacing': 0.2, 'symbol-spacing': 420 },
        paint: { 'text-color': P.waterLabel, 'text-halo-color': P.water, 'text-halo-width': 1 } }),
      label('street-label', 'transportation_name', { minzoom: 14.2, filter: ['match', ['get', 'class'], ['path', 'track', 'service', 'rail', 'transit'], false, true],
        layout: { 'symbol-placement': 'line', 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 12.5] } }),
      label('park-label', 'poi', { minzoom: 12.5, filter: ['==', ['get', 'class'], 'park'], paint: { 'text-color': P.parkLabel } }),
      label('place-quarter', 'place', { minzoom: 13, filter: ['match', ['get', 'class'], ['quarter', 'neighbourhood'], true, false],
        layout: { 'text-size': 11.5, 'text-letter-spacing': 0.04 } }),
      label('place-town', 'place', { minzoom: 9.5, filter: ['match', ['get', 'class'], ['town', 'village'], true, false], layout: { 'text-size': 12 } }),
      label('place-suburb', 'place', { minzoom: 10.5, maxzoom: 15.5, filter: ['==', ['get', 'class'], 'suburb'],
        layout: { 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 14, 13.5], 'text-letter-spacing': 0.06 },
        paint: { 'text-color': P.labelHi } }),
      label('place-city', 'place', { maxzoom: 11, filter: ['==', ['get', 'class'], 'city'], layout: { 'text-font': ['Noto Sans Bold'], 'text-size': 16 }, paint: { 'text-color': P.labelHi } }),
    ],
  };
}

function loadMapLibrary() {
  return new Promise((resolve, reject) => {
    let pending = 2;
    const done = () => { if (--pending === 0) resolve(); };
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/vendor/maplibre-gl.css';
    css.onload = done; css.onerror = done;        // the map still works without its stylesheet, just less tidy
    document.head.insertBefore(css, document.querySelector('link[rel="stylesheet"]'));   // before app.css, so our overrides win
    const js = document.createElement('script');
    js.src = '/vendor/maplibre-gl.js';
    js.onload = done; js.onerror = () => reject(new Error('Map library failed to load'));
    document.head.appendChild(js);
  });
}

// Camera maths: the sheet covers part of the map, so "centre" means the centre of what is still visible.
function mapPad() {
  if (desk.matches) return { top: 70, bottom: 30, left: 454, right: 30 };
  const top = window.innerHeight - el.sheet.offsetHeight + 6;   // bottom edge of the top bar
  return { top: Math.max(70, top), bottom: Math.min(visibleHeight('half'), visibleHeight(S.snap === 'full' ? 'half' : S.snap)) + 14, left: 26, right: 26 };
}
function padOffset() { const p = mapPad(); return [(p.left - p.right) / 2, (p.top - p.bottom) / 2]; }
function moveCamera(cam, duration, offset = true) {
  if (!map || !mapReady) return;
  const o = offset ? { ...cam, offset: padOffset() } : cam;
  if (reduceMotion.matches || !duration) map.easeTo({ ...o, duration: 0 });   // easeTo, because jumpTo ignores the offset
  else map.flyTo({ ...o, duration, essential: true });
}
function flyToClub(c) {
  if (!c.hasGeo) return;
  moveCamera({ center: [c.lng, c.lat], zoom: 15.6, pitch: 52, bearing: -16 }, 1500);
}
function fitToDay(animate) {
  if (!map || !mapReady || S.sel || !S.clubs.length) return;
  const day = T.week[S.dayIdx].name;
  let pts = S.byDay[day].filter(s => sessionMatches(s) && s.c.hasGeo).map(s => [s.c.lng, s.c.lat]);
  if (!pts.length) pts = S.clubs.filter(c => clubMatches(c) && c.hasGeo).map(c => [c.lng, c.lat]);
  if (!pts.length) return;
  const b = pts.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
  const cam = pts.length > 1 ? map.cameraForBounds(b, { padding: mapPad(), maxZoom: 13.6 }) : null;
  const dur = animate ? 800 : 0;
  if (cam && cam.zoom >= 11.2) {
    if (reduceMotion.matches || !dur) map.jumpTo({ ...cam, pitch: 0, bearing: 0 }); else map.flyTo({ ...cam, pitch: 0, bearing: 0, duration: dur, essential: true });
  } else {
    // Far-flung meeting points would shrink the city to a dot, so centre on the middle of the pack instead.
    const mid = k => pts.map(p => p[k]).sort((a, z) => a - z)[Math.floor(pts.length / 2)];
    moveCamera({ center: [mid(0), mid(1)], zoom: pts.length > 1 ? 11.2 : 13.2, pitch: 0, bearing: 0 }, dur);
  }
}

function buildPins() {
  if (!map) return;
  for (const p of pins.values()) p.marker.remove();
  pins.clear();
  const geo = S.clubs.filter(c => c.hasGeo);
  // Meeting points within ~60 m of each other are fanned out so every pin stays tappable.
  const groupOf = new Map();
  geo.forEach(c => {
    const near = geo.find(o => groupOf.has(o.id) && haversine(c.lat, c.lng, o.lat, o.lng) < 0.06);
    const g = near ? groupOf.get(near.id) : [];
    g.push(c); groupOf.set(c.id, g);
  });
  geo.forEach((c, i) => {
    const g = groupOf.get(c.id), k = g.indexOf(c), n = g.length;
    const r = n > 1 ? 12 + n * 3 : 0, a = n > 1 ? (2 * Math.PI * k) / n - Math.PI / 2 : 0;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pin drop';
    b.style.setProperty('--i', i);
    b.innerHTML = '<span class="pin-in"><span class="pin-dot"></span><span class="pin-time"></span></span>';
    b.addEventListener('click', e => { e.stopPropagation(); openDetail(c.id, b.dataset.day || null); });
    const marker = new maplibregl.Marker({ element: b, anchor: 'center', offset: [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))] })
      .setLngLat([c.lng, c.lat]).addTo(map);
    pins.set(c.id, { marker, el: b, time: b.querySelector('.pin-time') });
  });
  setTimeout(() => pins.forEach(p => p.el.classList.remove('drop')), 1600);
}
function updatePins() {
  if (!pins.size || !T) return;
  const day = T.week[S.dayIdx];
  const today = new Map(S.byDay[day.name].map(s => [s.c.id, s]));
  for (const c of S.clubs) {
    const p = pins.get(c.id);
    if (!p) continue;
    const s = today.get(c.id);
    const onDay = !!s && sessionMatches(s);
    const st = onDay ? statusOf(s, S.dayIdx) : null;
    const sel = !!S.sel && S.sel.id === c.id;
    const off = !onDay && !clubMatches(c) && !sel;
    const cl = p.el.classList;                    // toggle one by one: MapLibre keeps its own classes on this element
    cl.toggle('is-day', onDay); cl.toggle('is-soon', st === 'soon'); cl.toggle('is-live', st === 'live');
    cl.toggle('is-past', st === 'past'); cl.toggle('is-off', off); cl.toggle('is-sel', sel);
    p.time.textContent = onDay ? (s.start != null ? fmt(s.start) : timeWord(c, s.day).toLowerCase()) : '';
    if (onDay) p.el.dataset.day = day.name; else delete p.el.dataset.day;
    p.el.setAttribute('aria-label', c.name + (onDay ? ', ' + day.name + (s.start != null ? ' ' + fmt(s.start) : '') : '') + ', ' + c.meet);
    p.el.tabIndex = off ? -1 : 0;
    p.el.style.zIndex = sel ? 6 : st === 'soon' || st === 'live' ? 5 : onDay && st !== 'past' ? 4 : onDay ? 3 : off ? 0 : 1;
    p.start = onDay && s.start != null ? s.start : 1e4;
  }
  requestAnimationFrame(declutter);
}

// Time pins of nearby meeting points overlap when zoomed out. Nudge the lower-priority ones up or
// down so each stays readable and tappable; where there is no room, shrink the pin to a dot until you zoom in.
function declutter() {
  if (!map || !mapReady) return;
  const items = [];
  pins.forEach(p => p.el.classList.remove('is-tight'));
  for (const c of S.clubs) {
    const p = pins.get(c.id);
    if (!p) continue;
    const inner = p.el.firstElementChild;
    if (!p.el.classList.contains('is-day') || p.el.classList.contains('is-off')) { inner.style.translate = ''; continue; }
    const pt = map.project([c.lng, c.lat]), off = p.marker.getOffset();
    items.push({ p, inner, x: pt.x + off.x, y: pt.y + off.y, w: p.time.offsetWidth + 6, h: p.time.offsetHeight + 5, rank: +p.el.style.zIndex, start: p.start });
  }
  items.sort((a, b) => b.rank - a.rank || a.start - b.start);
  const placed = [];
  for (const it of items) {
    const free = y => !placed.some(q => Math.abs(q.x - it.x) < (q.w + it.w) / 2 && Math.abs(q.y - y) < (q.h + it.h) / 2);
    const step = [0, -1, 1, -2, 2].find(k => free(it.y + k * it.h));
    if (step === undefined) { it.p.el.classList.add('is-tight'); it.inner.style.translate = ''; continue; }
    placed.push({ x: it.x, y: it.y + step * it.h, w: it.w, h: it.h });
    it.inner.style.translate = step ? `0 ${step * it.h}px` : '';
  }
}

async function initMap() {
  try {
    await loadMapLibrary();
    map = new maplibregl.Map({
      container: 'map', style: mapStyle(theme()),
      center: [14.437, 50.083], zoom: 11.4, minZoom: 9, maxZoom: 17.5,
      maxBounds: [[13.55, 49.6], [15.35, 50.55]],
      attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      fadeDuration: reduceMotion.matches ? 0 : 250,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right');
    map.on('click', () => { if (S.sel) closeDetail(); });
    map.on('moveend', declutter);
    map.on('error', e => { if (navigator.onLine !== false) console.warn('Map:', (e && e.error && e.error.message) || e); });   // offline tile misses are expected
    map.once('load', () => {
      mapReady = true;
      el.map.classList.add('ready');
      const att = el.map.querySelector('.maplibregl-ctrl-attrib');
      if (att) { att.classList.remove('maplibregl-compact-show'); att.removeAttribute('open'); }
      const sel = S.sel && S.byId.get(S.sel.id);
      if (sel) flyToClub(sel); else fitToDay(false);
    });
    buildPins(); updatePins();
    if (S.user) showMe();
  } catch (err) {
    console.warn('Map unavailable, showing the list only:', err.message);
    map = null;
    document.documentElement.classList.add('map-off');
  }
}

/* ── Location ───────────────────────────────────────────────────────── */
function showMe() {
  if (!map || !S.user) return;
  if (!meMarker) { const d = document.createElement('div'); d.className = 'me'; d.setAttribute('aria-label', 'You are here'); meMarker = new maplibregl.Marker({ element: d }); }
  meMarker.setLngLat([S.user.lng, S.user.lat]).addTo(map);
}
function toggleLocate() {
  const b = el.btnLocate;
  if (S.user) {
    S.user = null; b.setAttribute('aria-pressed', 'false');
    if (meMarker) meMarker.remove();
    renderAll(); if (S.sel) renderDetail();
    return;
  }
  if (!navigator.geolocation) { toast("This browser can't share your location."); return; }
  b.classList.add('busy');
  navigator.geolocation.getCurrentPosition(pos => {
    b.classList.remove('busy'); b.setAttribute('aria-pressed', 'true');
    S.user = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    showMe();
    renderAll(); if (S.sel) renderDetail();
    const near = haversine(S.user.lat, S.user.lng, PRAGUE.lat, PRAGUE.lng) < 45;
    if (near && !S.sel) moveCamera({ center: [S.user.lng, S.user.lat], zoom: 13, pitch: 0, bearing: 0 }, 900);
    toast(near ? 'Showing distances from you' : "You're outside Prague. Distances are from where you are.");
  }, () => {
    b.classList.remove('busy');
    toast('Location is off. Allow it for this site to see distances.');
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 });
}

/* ── Theme ──────────────────────────────────────────────────────────── */
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = S.prefs.theme || 'auto';
  const th = pref === 'auto' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : pref;
  const changed = theme() !== th;
  document.documentElement.dataset.theme = th;
  document.querySelector('meta[name="theme-color"]').content = th === 'dark' ? '#0A1120' : '#E6EBF1';
  document.querySelectorAll('[data-theme-pref]').forEach(b => b.setAttribute('aria-pressed', b.dataset.themePref === pref));
  if (changed && map) map.setStyle(mapStyle(th));
}

/* ── Toast ──────────────────────────────────────────────────────────── */
let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2800);
}

/* ── Events ─────────────────────────────────────────────────────────── */
function initEvents() {
  el.btnLocate.innerHTML = ICON.locate;
  el.btnAbout.innerHTML = ICON.more;
  $('aboutClose').innerHTML = ICON.close;
  $('installClose').innerHTML = ICON.close;

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-open], [data-day-idx], [data-act], [data-filter], [data-unfilter], [role="tab"]');
    if (!t) return;
    if (t.dataset.open != null) {
      const raw = t.dataset.open, id = S.byId.has(raw) ? raw : Number(raw);
      openDetail(id, t.dataset.day || null);
    } else if (t.dataset.dayIdx != null) {
      if (t.dataset.go === 'day' || S.view !== 'day') { S.dayIdx = +t.dataset.dayIdx; setView('day'); fitToDay(true); }
      else setDay(+t.dataset.dayIdx);
    } else if (t.getAttribute('role') === 'tab') setView(t.dataset.view);
    else if (t.dataset.filter) toggleFilter(t.dataset.filter, t.dataset.v);
    else if (t.dataset.unfilter) toggleFilter(t.dataset.unfilter, t.dataset.v);
    else switch (t.dataset.act) {
      case 'close-detail': closeDetail(); break;
      case 'close-finder': closeFinder(); break;
      case 'clear-filters': clearFilters(); break;
      case 'refresh': loadData(true); break;
      case 'save': toggleSave(); break;
      case 'share': shareRun(); break;
      case 'ics': downloadIcs(); break;
      case 'cal': {
        const menu = $('calMenu'), open = menu.hidden;
        menu.hidden = !open; t.setAttribute('aria-expanded', open);
        if (open && !desk.matches && S.snap !== 'full') setSnap('full');
        break;
      }
    }
  });

  el.btnFind.addEventListener('click', () => openFinder());
  el.btnLocate.addEventListener('click', toggleLocate);
  el.btnAbout.addEventListener('click', () => { renderAbout(); el.about.showModal(); });
  $('aboutClose').addEventListener('click', () => el.about.close());
  el.about.addEventListener('click', e => { if (e.target === el.about) el.about.close(); });
  $('btnRefresh').addEventListener('click', () => loadData(true));
  $('themeSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-theme-pref]');
    if (!b) return;
    S.prefs.theme = b.dataset.themePref; store(PREFS_KEY, S.prefs); applyTheme();
  });
  darkQuery.addEventListener('change', applyTheme);

  let searchTimer;
  el.search.addEventListener('input', () => { S.q = el.search.value; renderClubs(); clearTimeout(searchTimer); });
  el.search.addEventListener('focus', () => { if (!desk.matches && S.snap !== 'full') setSnap('full'); });

  // Tabs: arrow keys move between them
  document.querySelector('.tabs').addEventListener('keydown', e => {
    const order = ['day', 'week', 'clubs'], i = order.indexOf(S.view);
    const next = e.key === 'ArrowRight' ? order[(i + 1) % 3] : e.key === 'ArrowLeft' ? order[(i + 2) % 3] : null;
    if (!next) return;
    e.preventDefault(); setView(next);
    document.querySelector(`.tabs [data-view="${next}"]`).focus();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || el.about.open) return;
    if (S.finder) closeFinder(); else if (S.sel) closeDetail();
  });

  // Phone back button and browser history close whatever is open
  window.addEventListener('popstate', () => {
    const st = history.state || {};
    if (st.run != null && S.byId.has(st.run)) openDetail(st.run, st.day, { fromHistory: true });
    else closeDetail({ fromHistory: true });
    if (st.finder) openFinder({ fromHistory: true }); else closeFinder({ fromHistory: true });
  });

  // Keep the clock honest: countdowns, "earlier today" and the day strip follow real time
  setInterval(tick, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    tick();
    if (Date.now() - lastFetch > 10 * 60000) loadData();
    loadWeather();
  });
  window.addEventListener('online', () => loadData());
}
function tick() {
  const dayChanged = refreshClock();
  if (dayChanged) S.dayIdx = 0;
  renderAll(); markSelected();
  if (S.sel) {
    // keep the open detail's countdown current without closing an open calendar menu
    const menu = $('calMenu');
    if (!menu || menu.hidden) { const top = el.detail.querySelector('.pane-body').scrollTop; renderDetail(); el.detail.querySelector('.pane-body').scrollTop = top; }
  }
}

/* ── App (PWA): offline support + install prompt ────────────────────── */
function initPwa() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Service worker not registered:', err));
    });
  }
  const banner = $('installBanner'), btn = $('installBtn'), text = $('installText'), aboutBtn = $('btnInstallAbout'), aboutIos = $('aboutIos');
  let deferredPrompt = null;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return;

  const shareIco = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  const dismissedAt = Number(read(DISMISS_KEY)) || 0;
  const mayShow = Date.now() - dismissedAt > 30 * 864e5;
  const show = () => { if (!mayShow || S.sel || S.finder) return; banner.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('visible'))); };
  const hide = remember => {
    banner.classList.remove('visible');
    setTimeout(() => { banner.hidden = true; }, 350);
    if (remember) store(DISMISS_KEY, Date.now());
  };
  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null; aboutBtn.hidden = true;
    hide(outcome !== 'accepted');
  };
  $('installClose').addEventListener('click', () => hide(true));
  btn.addEventListener('click', install);
  aboutBtn.addEventListener('click', () => { el.about.close(); install(); });
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredPrompt = e;
    btn.hidden = false; aboutBtn.hidden = false;
    setTimeout(show, 8000);
  });
  window.addEventListener('appinstalled', () => { hide(false); aboutBtn.hidden = true; });
  if (isIOS) {
    const how = `Tap ${shareIco} Share, then <b>Add to Home Screen</b>.`;
    text.innerHTML = '<strong>Get the app</strong>' + how;
    aboutIos.innerHTML = 'To install: ' + how; aboutIos.hidden = false;
    setTimeout(show, 8000);
  }
}

/* ── Start ──────────────────────────────────────────────────────────── */
function start() {
  const prefs = read(PREFS_KEY);
  if (prefs && typeof prefs === 'object') S.prefs = { theme: prefs.theme || 'auto', saved: Array.isArray(prefs.saved) ? prefs.saved : [] };
  S.saved = new Set(S.prefs.saved);
  refreshClock();
  applyTheme();
  initEvents();
  initSheet();
  renderAll();

  const deepLink = (location.hash.match(/^#run-(.+)$/) || [])[1];
  if (deepLink) history.replaceState(null, '', location.pathname + location.search);

  if (deepLink) onFirstData = () => {
    const id = S.byId.has(deepLink) ? deepLink : Number(deepLink);
    if (S.byId.has(id)) openDetail(id, null);
  };
  loadData();
  loadWeather();
  initPwa();
  // The map library is big, so it loads after the list is on screen.
  (window.requestIdleCallback || (fn => setTimeout(fn, 200)))(() => initMap());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
