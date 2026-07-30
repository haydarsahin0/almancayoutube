// Ayarlar, kelime defteri, önbellek ve kitaplık deposu (localStorage + IndexedDB)
import { hash, normWord } from './util.js';

const SET_KEY = 'dl.settings';
const VOCAB_KEY = 'dl.vocab';
const CACHE_KEY = 'dl.cache';

const DEFAULTS = {
  apiKey: '',
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1',
  level: 'A2',
  autoscroll: true,
  fontSize: 19,
  autoSpeak: false,
  readerTheme: 'sepia',   // sepia | light | dark
  lineHeight: 1.78,
  readerFont: 'serif',    // serif | sans
  justify: true,
};

let settings = null;
export function getSettings() {
  if (!settings) {
    try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SET_KEY) || '{}') }; }
    catch { settings = { ...DEFAULTS }; }
  }
  return settings;
}
export function setSettings(patch) {
  settings = { ...getSettings(), ...patch };
  localStorage.setItem(SET_KEY, JSON.stringify(settings));
  return settings;
}

/* ----------------------------- kelime defteri ----------------------------- */
let vocab = null;
function loadVocab() {
  if (!vocab) {
    try { vocab = JSON.parse(localStorage.getItem(VOCAB_KEY) || '[]'); }
    catch { vocab = []; }
    if (!Array.isArray(vocab)) vocab = [];
  }
  return vocab;
}
function saveVocab() {
  try { localStorage.setItem(VOCAB_KEY, JSON.stringify(vocab)); }
  catch (e) { console.warn('kelime defteri kaydedilemedi', e); }
}
export const allVocab = () => loadVocab();
export const vocabKeys = () => new Set(loadVocab().map(v => normWord(v.lemma || v.word)));

export function findVocab(word) {
  const k = normWord(word);
  return loadVocab().find(v => normWord(v.word) === k || normWord(v.lemma) === k) || null;
}
export function saveWord(entry) {
  loadVocab();
  const k = normWord(entry.lemma || entry.word);
  const i = vocab.findIndex(v => normWord(v.lemma || v.word) === k);
  const rec = {
    word: entry.word, lemma: entry.lemma || entry.word,
    artikel: entry.artikel || '', wortart: entry.wortart || '', niveau: entry.niveau || '',
    tr: entry.tr || '', de: entry.de || '', example: entry.example || '',
    source: entry.source || '', context: entry.context || '',
    added: i >= 0 ? vocab[i].added : Date.now(),
    box: i >= 0 ? vocab[i].box : 0, seen: i >= 0 ? vocab[i].seen : 0,
  };
  if (i >= 0) vocab[i] = rec; else vocab.unshift(rec);
  saveVocab();
  return rec;
}
export function removeWord(word) {
  loadVocab();
  const k = normWord(word);
  const i = vocab.findIndex(v => normWord(v.lemma || v.word) === k);
  if (i >= 0) { vocab.splice(i, 1); saveVocab(); }
}
export function updateWord(word, patch) {
  loadVocab();
  const k = normWord(word);
  const i = vocab.findIndex(v => normWord(v.lemma || v.word) === k);
  if (i >= 0) { vocab[i] = { ...vocab[i], ...patch }; saveVocab(); }
}
export function importVocab(list) {
  loadVocab();
  let n = 0;
  for (const it of list || []) {
    if (!it || !it.word) continue;
    const k = normWord(it.lemma || it.word);
    if (vocab.some(v => normWord(v.lemma || v.word) === k)) continue;
    vocab.push({ box: 0, seen: 0, added: Date.now(), ...it });
    n++;
  }
  saveVocab();
  return n;
}

/* -------------------------------- istatistik ------------------------------ */
const STATS_KEY = 'dl.stats';
let stats = null;

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function getStats() {
  if (!stats) {
    try { stats = JSON.parse(localStorage.getItem(STATS_KEY) || '{}'); } catch { stats = {}; }
    if (!stats || typeof stats !== 'object') stats = {};
    if (!stats.days) stats.days = {};
  }
  return stats;
}

/** Bugünün sayacını artırır: pages | secs | lookups | saves | reviews | correct */
export function bumpStat(field, by = 1) {
  const s = getStats();
  const k = todayKey();
  const d = s.days[k] || (s.days[k] = { pages: 0, secs: 0, lookups: 0, saves: 0, reviews: 0, correct: 0 });
  d[field] = (d[field] || 0) + by;
  if (!s.firstDay) s.firstDay = k;
  const keys = Object.keys(s.days);
  if (keys.length > 400) keys.sort().slice(0, keys.length - 400).forEach(x => delete s.days[x]);
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* dolu ise yoksay */ }
  document.dispatchEvent(new CustomEvent('stats-changed'));
}

export const dayStat = (key) => getStats().days[key] || { pages: 0, secs: 0, lookups: 0, saves: 0, reviews: 0, correct: 0 };

/* ------------------------------ AI önbelleği ------------------------------ */
let cache = null;
function loadCache() {
  if (!cache) {
    try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
    catch { cache = {}; }
  }
  return cache;
}
export function cacheGet(key) { return loadCache()[hash(key)]?.v ?? null; }
export function cacheSet(key, value) {
  loadCache();
  cache[hash(key)] = { v: value, t: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > 700) {
    keys.sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0)).slice(0, 200).forEach(k => delete cache[k]);
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
  catch { cache = {}; localStorage.removeItem(CACHE_KEY); }
}

/* ------------------------------- kitaplık -------------------------------- */
const DB_NAME = 'dl-library', STORE = 'books';
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
export const putBook = (book) => tx('readwrite', s => s.put(book));
export const getBook = (id) => tx('readonly', s => s.get(id));
export const listBooks = () => tx('readonly', s => s.getAll()).then(r => (r || []).sort((a, b) => b.opened - a.opened));
export const deleteBook = (id) => tx('readwrite', s => s.delete(id));
