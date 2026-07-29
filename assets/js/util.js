// Ortak yardımcılar
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Almanca kelime yakalayıcı (ä ö ü ß dahil, tire ve kesme işareti bileşikleri dahil)
const WORD_SRC = "[\\p{L}\\p{M}][\\p{L}\\p{M}\\p{Nd}]*(?:[-'’][\\p{L}\\p{M}][\\p{L}\\p{M}\\p{Nd}]*)*";
export const wordRe = () => new RegExp(WORD_SRC, 'gu');

/** Metni kelime / kelime-dışı parçalara ayırır */
export function tokenize(text) {
  const out = [];
  const re = wordRe();
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ w: false, v: text.slice(last, m.index) });
    out.push({ w: true, v: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ w: false, v: text.slice(last) });
  return out;
}

/** Metni, her kelimesi tıklanabilir <span class="w"> olan bir fragment'a çevirir */
export function wordSpans(text) {
  const frag = document.createDocumentFragment();
  for (const t of tokenize(text)) {
    if (t.w) frag.append(el('span', { class: 'w' }, t.v));
    else frag.append(document.createTextNode(t.v));
  }
  return frag;
}

export const normWord = (w) => String(w || '').replace(/[’]/g, "'").trim().toLowerCase();

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
           : `${m}:${String(s).padStart(2, '0')}`;
}

export function toast(msg, ms = 2600) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

export function speak(text, lang = 'de-DE') {
  try {
    if (!('speechSynthesis' in window)) return toast('Bu cihaz sesli okumayı desteklemiyor.');
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = lang; u.rate = 0.92;
    const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) { /* yoksay */ }
}
if ('speechSynthesis' in window) { try { speechSynthesis.getVoices(); } catch (e) {} }

/* ------------------------------------------------------------------ */
/* CORS aracıları — YouTube sayfaları tarayıcıdan doğrudan okunamadığı  */
/* için birkaç genel proxy sırayla denenir.                            */
/* ------------------------------------------------------------------ */
const PROXIES = [
  { id: 'direct', url: u => u },
  { id: 'allorigins', url: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
  { id: 'corsproxy', url: u => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
  { id: 'codetabs', url: u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u) },
  { id: 'isomorphic', url: u => 'https://cors.isomorphic-git.org/' + u.replace(/^https?:\/\//, 'https://') },
];
const PREF_KEY = 'dl.proxy.pref';

async function tryFetch(url, timeout) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, { signal: c.signal, credentials: 'omit', redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

/**
 * CORS engelini aşarak metin çeker. `validate(text)` doğru sonucu ayırt eder.
 */
export async function fetchVia(url, { timeout = 16000, validate = null, skipDirect = false } = {}) {
  const pref = localStorage.getItem(PREF_KEY);
  let list = PROXIES.filter(p => !(skipDirect && p.id === 'direct'));
  if (pref) list = [...list.filter(p => p.id === pref), ...list.filter(p => p.id !== pref)];
  let lastErr;
  for (const p of list) {
    try {
      const txt = await tryFetch(p.url(url), timeout);
      if (!txt || txt.length < 20) throw new Error('boş yanıt');
      if (validate && !validate(txt)) throw new Error('beklenen içerik yok');
      if (p.id !== 'direct') localStorage.setItem(PREF_KEY, p.id);
      return txt;
    } catch (e) { lastErr = e; }
  }
  throw new Error('İnternetten okunamadı: ' + (lastErr ? lastErr.message : 'bilinmeyen hata'));
}

export function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function decodeEntities(s) {
  const ta = document.createElement('textarea');
  ta.innerHTML = String(s ?? '');
  return ta.value;
}

/** Bir kelimeyi içeren cümleyi metinden çıkarır */
export function sentenceAround(fullText, index, maxLen = 320) {
  if (!fullText) return '';
  const before = fullText.slice(Math.max(0, index - maxLen), index);
  const after = fullText.slice(index, index + maxLen);
  const bIdx = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf('\n'));
  const aM = after.match(/[.!?\n]/);
  const start = bIdx >= 0 ? bIdx + 1 : 0;
  const end = aM ? index + aM.index + 1 : index + after.length;
  return fullText.slice(Math.max(0, index - maxLen) + start, end).trim();
}
