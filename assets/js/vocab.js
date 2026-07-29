// Kelime defteri + kart çalışması
import { $, el, speak, toast } from './util.js';
import { allVocab, removeWord, updateWord, importVocab } from './store.js';
import { openWord } from './word.js';
import { showModal, closeModal } from './ui.js';

let filter = '';

export function renderVocab() {
  const list = allVocab().filter(v => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (v.word + ' ' + v.lemma + ' ' + (v.tr || '')).toLowerCase().includes(f);
  });
  const box = $('#vocab-list');
  const total = allVocab().length;
  $('#vocab-stats').textContent = total
    ? `${total} kelime kayıtlı${filter ? ` • ${list.length} sonuç` : ''}`
    : 'Henüz kelime yok. Video ya da kitapta bir kelimeye dokunup ⭐ ile kaydet.';
  box.replaceChildren(...list.map(v => el('div', { class: 'vrow' },
    el('div', { class: 'main' },
      el('div', { class: 'de' }, (v.artikel ? v.artikel + ' ' : '') + (v.lemma || v.word),
        v.wortart ? el('span', { class: 'tag', style: 'margin-left:8px' }, v.wortart) : null),
      el('div', { class: 'tr' }, v.tr || ''),
      v.example ? el('div', { class: 'src' }, v.example) : null,
      v.source ? el('div', { class: 'src' }, '↳ ' + v.source) : null),
    el('div', { class: 'acts' },
      el('button', { class: 'mini', title: 'Seslendir', onclick: () => speak((v.artikel ? v.artikel + ' ' : '') + (v.lemma || v.word)) }, '🔊'),
      el('button', { class: 'mini', title: 'Detay', onclick: () => openWord(v.lemma || v.word, v.context || '', v.source || '') }, 'ℹ️'),
      el('button', {
        class: 'mini', title: 'Sil',
        onclick: () => { removeWord(v.lemma || v.word); renderVocab(); toast('Silindi'); },
      }, '🗑')),
  )));
}

/* ------------------------------ kart çalışması ----------------------------- */
function flashcards() {
  const pool = allVocab().slice().sort((a, b) => (a.box || 0) - (b.box || 0) || (a.seen || 0) - (b.seen || 0));
  if (!pool.length) return toast('Önce kelime kaydet.');
  let i = 0, flipped = false;

  const draw = () => {
    const v = pool[i % pool.length];
    const front = (v.artikel ? v.artikel + ' ' : '') + (v.lemma || v.word);
    const card = el('div', { class: 'card' },
      el('div', { class: 'q' }, front),
      flipped ? el('div', { class: 'a' }, v.tr || '—') : null,
      flipped && v.de ? el('div', { style: 'font-size:14px;color:var(--tx-dim)' }, v.de) : null,
      flipped && v.example ? el('div', { style: 'font-size:13.5px;color:var(--tx-dim)' }, v.example) : null,
    );
    const body = el('div', { class: 'flash' },
      el('div', { style: 'color:var(--tx-dim);font-size:12px;margin-bottom:8px' }, `${(i % pool.length) + 1} / ${pool.length}`),
      card,
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => speak(front) }, '🔊'),
        flipped
          ? el('button', {
              class: 'btn', onclick: () => {
                updateWord(v.lemma || v.word, { box: 0, seen: (v.seen || 0) + 1 });
                i++; flipped = false; draw();
              },
            }, '😕 Bilmedim')
          : el('button', { class: 'btn primary grow', onclick: () => { flipped = true; draw(); } }, 'Çevir'),
        flipped
          ? el('button', {
              class: 'btn primary', onclick: () => {
                updateWord(v.lemma || v.word, { box: (v.box || 0) + 1, seen: (v.seen || 0) + 1 });
                i++; flipped = false; draw();
              },
            }, '🙂 Biliyorum')
          : null,
      ),
      el('div', { style: 'margin-top:10px' },
        el('button', { class: 'chip', onclick: () => { closeModal(); renderVocab(); } }, 'Bitir')),
    );
    showModal('Kart çalışması', body);
  };
  draw();
}

/* -------------------------------- kurulum --------------------------------- */
export function initVocab() {
  $('#vocab-search').addEventListener('input', (e) => { filter = e.target.value; renderVocab(); });
  $('#btn-flash').addEventListener('click', flashcards);
  $('#btn-vocab-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(allVocab(), null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'almanca-kelimelerim.json' });
    document.body.append(a); a.click(); a.remove();
  });
  $('#vocab-import').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const n = importVocab(JSON.parse(await f.text()));
      toast(`${n} kelime eklendi`); renderVocab();
    } catch { toast('Dosya okunamadı.'); }
    e.target.value = '';
  });
  document.addEventListener('vocab-changed', renderVocab);
  renderVocab();
}
