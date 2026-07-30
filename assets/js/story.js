// Hikâye modu: kayıtlı kelimeleri tek bir metin içinde, altı çizili olarak göster
import { $, el, toast, speak, tokenize, normWord, sentenceAround } from './util.js';
import { allVocab, updateWord, getSettings, bumpStat } from './store.js';
import { storyWithWords, AIError } from './ai.js';
import { openWord } from './word.js';
import { normalize } from './srs.js';

const LAST_KEY = 'dl.story.last';
const WORDS_PER_STORY = 6;

let current = null;   // {data, words}
let busy = false;

const storyEl = () => $('#story');

const shuffle = (a) => a.map(x => [Math.random(), x]).sort((x, y) => x[0] - y[0]).map(x => x[1]);

/**
 * Metinde en az kullanılmış kelimelerden bir grup seçer; böylece "yeni metin"
 * dedikçe defterin sırayla dolaşılır. Eşit sayıdakiler arasında rastgele seçer
 * ve yeterince kelime varsa bir önceki metnin kelimelerini tekrar kullanmaz.
 */
function pickWords(n = WORDS_PER_STORY) {
  const pool = allVocab().map(normalize);
  if (pool.length <= n) return shuffle(pool);
  const key = (w) => normWord(w.lemma || w.word);
  const prev = new Set((current?.words || []).map(key));
  // en az kullanılan önce; eşitler arasında rastgele
  const byLeastUsed = (list) => list
    .map(w => [w.storySeen || 0, Math.random(), w])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(x => x[2]);

  // önceki metnin kelimeleri mümkün olduğunca tekrar edilmez
  const picked = byLeastUsed(pool.filter(w => !prev.has(key(w)))).slice(0, n);
  if (picked.length < n) picked.push(...byLeastUsed(pool.filter(w => prev.has(key(w)))).slice(0, n - picked.length));
  return picked;
}

/* ------------------------------- gösterim -------------------------------- */
function markSet(data, words) {
  // hem verilen kelimeler hem de modelin bildirdiği çekimli hâller vurgulanır
  const set = new Set();
  for (const w of words) {
    set.add(normWord(w.lemma || w.word));
    if (w.word) set.add(normWord(w.word));
  }
  for (const b of data.benutzt || []) {
    if (b.form) String(b.form).split(/\s+/).forEach(t => set.add(normWord(t)));
    if (b.wort) String(b.wort).split(/\s+/).forEach(t => set.add(normWord(t)));
  }
  set.delete('der'); set.delete('die'); set.delete('das');
  return set;
}

function paragraphs(text, hl, full) {
  return String(text || '').split(/\n\s*\n|\n/).map(p => p.trim()).filter(Boolean).map(pt => {
    const node = el('p');
    for (const t of tokenize(pt)) {
      if (!t.w) { node.append(document.createTextNode(t.v)); continue; }
      const span = el('span', { class: 'w' + (hl.has(normWord(t.v)) ? ' hl' : '') }, t.v);
      node.append(span);
    }
    return node;
  });
}

function render() {
  const { data, words } = current;
  const hl = markSet(data, words);
  const body = $('#story-body');
  const full = data.text || '';

  body.replaceChildren(
    el('article', { class: 'paper story-paper on', 'data-theme': getSettings().readerTheme || 'sepia', lang: 'de' },
      data.titel ? el('h2', { class: 'story-title' }, data.titel) : null,
      ...paragraphs(full, hl),
      el('div', { class: 'story-tr', id: 'story-tr', hidden: true },
        el('h4', {}, 'Türkçesi'), el('p', {}, data.tr || '')),
    ),
    el('div', { class: 'story-words' },
      el('div', { class: 'card-h' }, el('span', { class: 'card-i' }, '⭐'), 'Bu metinde geçen kelimelerin'),
      el('div', { class: 'chips' }, ...words.map(w => {
        const label = (w.artikel ? w.artikel + ' ' : '') + (w.lemma || w.word);
        return el('button', { class: 'chip', onclick: () => openWord(w.lemma || w.word, w.context || '', 'hikâye') },
          label, w.tr ? el('small', { style: 'color:var(--tx-dim);margin-left:6px' }, w.tr.split(',')[0]) : null);
      })),
      el('p', { class: 'hint' }, 'Metinde altı çizili olanlar senin kelimelerin. Metindeki herhangi bir kelimeye dokunabilirsin.'),
    ),
  );

  // metindeki her kelime tıklanabilir
  body.querySelectorAll('.story-paper .w').forEach(sp => {
    sp.addEventListener('click', () => {
      const blk = sp.closest('p');
      const text = blk ? blk.textContent : full;
      let idx = 0;
      for (const node of (blk ? blk.childNodes : [])) { if (node === sp) break; idx += (node.textContent || '').length; }
      openWord(sp.textContent, sentenceAround(text, idx) || text.slice(0, 300), 'hikâye');
    });
  });
}

function loading(msg = 'Metnin yazılıyor…') {
  $('#story-body').replaceChildren(el('div', { class: 'story-loading' },
    el('div', { class: 'big' }, '✍️'),
    el('p', {}, el('span', { class: 'spinner' }), ' ' + msg),
    el('p', { class: 'hint' }, 'Kelimelerin anlamlı bir metin içinde birleştiriliyor.')));
}

function errorView(e) {
  const msg = e instanceof AIError && e.kind === 'nokey'
    ? 'Önce ⚙️ Ayarlar\'dan OpenAI anahtarını gir.' : (e.message || 'Bir hata oldu.');
  $('#story-body').replaceChildren(el('div', { class: 'story-loading' },
    el('div', { class: 'err-box' }, msg),
    el('button', { class: 'btn', style: 'margin-top:12px', onclick: () => newStory() }, 'Tekrar dene')));
}

/* -------------------------------- akış ----------------------------------- */
export async function newStory(force = false) {
  if (busy) return;
  const words = pickWords();
  if (words.length < 3) {
    return toast('Önce en az 3 kelime kaydet — metni onlarla yazayım.');
  }
  busy = true;
  storyEl().hidden = false;
  loading();
  try {
    const data = await storyWithWords(words, { seed: Date.now() % 1000, force });
    current = { data, words };
    words.forEach(w => updateWord(w.lemma || w.word, { storySeen: (w.storySeen || 0) + 1 }));
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ data, words: words.map(w => ({ ...w })) }));
    } catch { /* yer yoksa yoksay */ }
    if (!data._cached) bumpStat('lookups');
    render();
  } catch (e) {
    console.error(e);
    errorView(e);
  } finally { busy = false; }
}

export function openStory() {
  storyEl().hidden = false;
  if (current) return render();
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
    if (last?.data?.text) { current = last; return render(); }
  } catch { /* yoksay */ }
  newStory();
}

function closeStory() { storyEl().hidden = true; }

function toggleTr() {
  const t = $('#story-tr');
  if (!t) return;
  t.hidden = !t.hidden;
  $('#btn-story-tr').classList.toggle('on', !t.hidden);
  if (!t.hidden) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function initStory() {
  $('#btn-story').addEventListener('click', openStory);
  $('#story-close').addEventListener('click', closeStory);
  $('#btn-story-new').addEventListener('click', () => newStory());
  $('#btn-story-new2').addEventListener('click', () => newStory());
  $('#btn-story-tr').addEventListener('click', toggleTr);
  $('#btn-story-speak').addEventListener('click', () => {
    if (current?.data?.text) speak(current.data.text.slice(0, 900));
  });
  document.addEventListener('start-story', () => openStory());
}
