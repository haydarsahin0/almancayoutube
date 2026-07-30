// Kelime defteri + aralıklı tekrar çalışması
import { $, el, speak, toast } from './util.js';
import { allVocab, removeWord, importVocab, bumpStat } from './store.js';
import { openWord } from './word.js';
import { dueQueue, dueCount, answer as srsAnswer, levelOf, dueText, normalize, nextDueAt } from './srs.js';

let filter = '';
let sortBy = 'due';   // due | new | az

/* ------------------------------ kelime listesi ---------------------------- */
export function renderVocab() {
  let list = allVocab().map(normalize);
  if (filter) {
    const f = filter.toLowerCase();
    list = list.filter(v => (v.word + ' ' + v.lemma + ' ' + (v.tr || '')).toLowerCase().includes(f));
  }
  if (sortBy === 'due') list.sort((a, b) => a.due - b.due);
  else if (sortBy === 'new') list.sort((a, b) => (b.added || 0) - (a.added || 0));
  else list.sort((a, b) => (a.lemma || '').localeCompare(b.lemma || '', 'de'));

  const total = allVocab().length;
  const due = dueCount();
  const next = nextDueAt();
  $('#vocab-stats').replaceChildren(
    el('span', {}, total
      ? `${total} kelime${filter ? ` · ${list.length} sonuç` : ''}`
      : 'Henüz kelime yok. Kitapta bir kelimeye dokunup ⭐ ile kaydet.'),
    total ? el('span', { style: 'margin-left:8px;color:var(--accent)' },
      due ? `· ${due} tanesi bugün tekrar edilmeli` : (next ? `· sıradaki tekrar ${dueText({ due: next })}` : '')) : null,
  );

  $('#vocab-list').replaceChildren(...list.map(v => {
    const lv = levelOf(v);
    return el('div', { class: 'vrow' },
      el('div', { class: 'main' },
        el('div', { class: 'de' }, (v.artikel ? v.artikel + ' ' : '') + (v.lemma || v.word)),
        el('div', { class: 'tr' }, v.tr || ''),
        el('div', { class: 'src' },
          el('span', { class: 'sw', style: `background:${lv.color}` }),
          `${lv.label} · tekrar ${dueText(v)}${v.reps ? ` · ${v.reps} kez` : ''}`)),
      el('div', { class: 'acts' },
        el('button', { class: 'mini', title: 'Seslendir', onclick: () => speak((v.artikel ? v.artikel + ' ' : '') + (v.lemma || v.word)) }, '🔊'),
        el('button', { class: 'mini', title: 'Detay', onclick: () => openWord(v.lemma || v.word, v.context || '', v.source || '') }, 'ℹ️'),
        el('button', {
          class: 'mini', title: 'Sil',
          onclick: () => { removeWord(v.lemma || v.word); renderVocab(); toast('Silindi'); },
        }, '🗑')));
  }));
}

/* -------------------------------- çalışma --------------------------------- */
let queue = [], idx = 0, revealed = false, session = { done: 0, correct: 0 };

const studyEl = () => $('#study');

function closeStudy() {
  studyEl().hidden = true;
  renderVocab();
  document.dispatchEvent(new CustomEvent('vocab-changed'));
}

export function startStudy() {
  queue = dueQueue(20);
  if (!queue.length) {
    const next = nextDueAt();
    return toast(next ? `Şimdilik hepsi tamam 🎉 Sıradaki tekrar ${dueText({ due: next })}` : 'Önce kitapta kelime kaydet.');
  }
  idx = 0; revealed = false; session = { done: 0, correct: 0 };
  studyEl().hidden = false;
  draw();
}

function drawFinish() {
  const left = dueCount();
  $('#study-count').textContent = '';
  $('#study-prog-bar').style.width = '100%';
  $('#study-body').replaceChildren(el('div', { class: 'study-done' },
    el('div', { class: 'big' }, '🎉'),
    el('h2', {}, 'Tur bitti'),
    el('p', {}, `${session.done} kart çalıştın · ${session.done ? Math.round((session.correct / session.done) * 100) : 0}% bildin`),
    el('p', { class: 'hint' }, left
      ? `${left} kelime daha bugün tekrar edilmeyi bekliyor.`
      : 'Bugünlük tekrar bitti. Yarın yeni kartlar hazır olacak.'),
    el('div', { style: 'display:flex;gap:8px;margin-top:16px;width:100%' },
      left ? el('button', { class: 'btn primary grow', onclick: startStudy }, 'Devam et') : null,
      el('button', { class: 'btn grow', onclick: closeStudy }, 'Bitir')),
  ));
}

function draw() {
  if (idx >= queue.length) return drawFinish();
  const v = queue[idx];
  const lv = levelOf(v);
  const front = (v.artikel ? v.artikel + ' ' : '') + (v.lemma || v.word);

  $('#study-count').textContent = `${idx + 1} / ${queue.length}`;
  $('#study-prog-bar').style.width = `${(idx / queue.length) * 100}%`;

  const back = el('div', { class: 'reveal' + (revealed ? ' on' : '') },
    el('div', { class: 'tr-big' }, v.tr || '—'),
    v.de ? el('div', { class: 'de-small' }, v.de) : null,
    v.example ? el('div', { class: 'ex-small' }, v.example) : null,
  );
  const tapHint = el('div', { class: 'tap-hint' + (revealed ? ' off' : '') }, '👆 anlamı görmek için dokun');

  const reveal = () => {
    if (revealed) return;
    revealed = true;
    back.classList.add('on');
    tapHint.classList.add('off');
    $('#study-actions').replaceChildren(...answerButtons(v));
  };
  back.addEventListener('click', reveal);
  tapHint.addEventListener('click', reveal);

  $('#study-body').replaceChildren(
    el('div', { class: 'study-card' },
      el('div', { class: 'lvl' }, el('span', { class: 'sw', style: `background:${lv.color}` }), lv.label,
        v.reps ? ` · ${v.reps}. tekrar` : ' · ilk kez'),
      el('div', { class: 'front' }, front,
        el('button', { class: 'mini', style: 'margin-left:10px', onclick: (e) => { e.stopPropagation(); speak(front); } }, '🔊')),
      v.wortart ? el('div', { class: 'tag' }, v.wortart) : null,
      back, tapHint,
    ),
    el('div', { class: 'study-actions', id: 'study-actions' },
      ...(revealed ? answerButtons(v) : [el('button', { class: 'btn primary grow', onclick: reveal }, 'Anlamını göster')])),
    el('button', {
      class: 'chip', style: 'margin:14px auto 0;display:block',
      onclick: () => openWord(v.lemma || v.word, v.context || '', v.source || ''),
    }, 'ℹ️ Bu kelime hakkında detay'),
  );
}

function answerButtons(v) {
  const go = (known) => {
    const updated = srsAnswer(v, known);   // güncel kutu/tarih bilgisiyle döner
    bumpStat('reviews');
    if (known) bumpStat('correct');
    session.done++;
    if (known) session.correct++;
    else queue.push(updated);              // bilinmeyen kelime aynı turda tekrar sorulur
    idx++; revealed = false;
    draw();
  };
  return [
    el('button', { class: 'btn again grow', onclick: () => go(false) }, '😕 Bilmiyorum'),
    el('button', { class: 'btn primary grow', onclick: () => go(true) }, '🙂 Biliyorum'),
  ];
}

/* -------------------------------- kurulum --------------------------------- */
export function initVocab() {
  $('#vocab-search').addEventListener('input', (e) => { filter = e.target.value; renderVocab(); });
  $('#btn-flash').addEventListener('click', startStudy);
  $('#study-close').addEventListener('click', closeStudy);
  document.addEventListener('start-study', startStudy);
  $('#vocab-sort').addEventListener('change', (e) => { sortBy = e.target.value; renderVocab(); });

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
