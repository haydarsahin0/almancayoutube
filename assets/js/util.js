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

export function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
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
