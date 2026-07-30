// Kelime paneli (alttan açılan sayfa)
import { $, el, speak, toast, tokenize } from './util.js';
import { lookupWord, translateSentence, explainPhrase, AIError } from './ai.js';
import { findVocab, saveWord, removeWord, getSettings, bumpStat } from './store.js';

const sheet = () => $('#word-sheet');
const backdrop = () => $('#sheet-backdrop');
const body = () => $('#word-sheet-body');

let onCloseCb = null;
let current = null; // {word, context, data, source}

export function closeSheet() {
  sheet().hidden = true;
  backdrop().hidden = true;
  current = null;
  if (onCloseCb) { const f = onCloseCb; onCloseCb = null; f(); }
}

function openSheet() {
  sheet().hidden = false;
  backdrop().hidden = false;
  body().scrollTop = 0;
}

export function initWordSheet() {
  backdrop().addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet().hidden) closeSheet(); });
  // aşağı sürükleyerek kapat
  let y0 = null;
  sheet().addEventListener('touchstart', e => { if (body().scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  sheet().addEventListener('touchmove', e => {
    if (y0 === null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy > 90) { y0 = null; closeSheet(); }
  }, { passive: true });
  sheet().addEventListener('touchend', () => { y0 = null; }, { passive: true });
}

function loading(title) {
  const bar = $('#word-sheet-actions');
  if (bar) { bar.hidden = true; bar.replaceChildren(); }
  body().replaceChildren(
    el('header', { class: 'w-head' },
      el('div', { class: 'w-title' }, el('span', { class: 'w-lemma' }, title)),
      el('div', { class: 'w-chips' }, el('span', { class: 'chip-s' }, 'yapay zeka düşünüyor…'))),
    el('div', { class: 'card' },
      ...[95, 70, 88, 55].map(w => el('div', { class: 'skeleton', style: `width:${w}%` }))),
    el('div', { class: 'card' },
      ...[80, 92, 60].map(w => el('div', { class: 'skeleton', style: `width:${w}%` }))),
  );
}

function errorBox(e, retry) {
  const kind = e instanceof AIError ? e.kind : 'other';
  const msgs = {
    nokey: 'OpenAI API anahtarı girilmemiş. Sağ üstteki ⚙️ Ayarlar\'dan ekle.',
    auth: 'API anahtarı geçersiz ya da yetkisi yok. Ayarlar\'dan kontrol et.',
    limit: 'OpenAI limiti doldu ya da bakiyen bitti (429). Biraz bekleyip tekrar dene.',
    net: 'İnternete ulaşılamadı. Bağlantını kontrol et.',
  };
  return el('div', { class: 'err-box' },
    el('div', {}, msgs[kind] || 'Bir hata oldu.'),
    el('div', { style: 'margin-top:6px;color:#c8b0b0;font-size:12.5px' }, e.message || ''),
    retry ? el('div', { style: 'margin-top:10px' }, el('button', { class: 'btn', onclick: retry }, 'Tekrar dene')) : null,
  );
}

function ctxBlock(context, word) {
  if (!context) return null;
  const wrap = el('div', { class: 'ctx' });
  const lower = context.toLowerCase(), w = String(word).toLowerCase();
  let i = lower.indexOf(w);
  if (i < 0) wrap.append(context);
  else {
    wrap.append(context.slice(0, i), el('mark', {}, context.slice(i, i + word.length)), context.slice(i + word.length));
  }
  const btn = el('button', { class: 'chip', style: 'margin-top:8px' }, '🇹🇷 Cümleyi çevir');
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Çevriliyor…';
    try {
      const t = await translateSentence(context);
      btn.replaceWith(el('div', { style: 'margin-top:8px' },
        el('div', { class: 'tr-txt' }, t.tr || ''),
        t.not ? el('div', { style: 'color:var(--tx-dim);font-size:13px;margin-top:4px' }, '📝 ' + t.not) : null,
      ));
    } catch (e) { btn.disabled = false; btn.textContent = 'Tekrar dene'; toast(e.message); }
  });
  return el('div', {}, wrap, btn);
}

/** A1…C2 rozeti — seviye metni her zaman yazılı, renk yalnızca destek */
export function levelBadge(niveau, extraClass = '') {
  const lv = String(niveau || '').toUpperCase().trim();
  if (!/^[ABC][12]$/.test(lv)) return null;
  const band = lv[0] === 'A' ? 'a' : lv[0] === 'B' ? 'b' : 'c';
  return el('span', { class: `cefr cefr-${band} ${extraClass}`.trim(), title: `Kelime seviyesi: ${lv}` }, lv);
}

function block(title, ...kids) {
  if (!kids.filter(Boolean).length) return null;
  return el('div', { class: 'blk' }, el('h4', {}, title), ...kids.filter(Boolean));
}

function render(d, word, context, source) {
  const lemma = d.lemma || word;
  const artikel = (d.artikel || '').trim();
  const full = (artikel ? artikel + ' ' : '') + lemma;
  const gender = { der: 'm', die: 'f', das: 'n' }[artikel.toLowerCase()] || '';

  // kayıtlı bir kelimeyi tekrar açtıysak kaydı tazele (eş anlamlılar, seviye…)
  if (findVocab(lemma)) updateSaved(d, lemma, artikel, source, context);

  const nodes = [
    // ---- başlık ----
    el('header', { class: 'w-head' },
      el('div', { class: 'w-title' },
        artikel ? el('span', { class: `art art-${gender}` }, artikel) : null,
        el('span', { class: 'w-lemma' }, lemma)),
      d.wort && d.wort.toLowerCase() !== lemma.toLowerCase()
        ? el('div', { class: 'w-form' }, 'metinde: ', el('b', {}, d.wort)) : null,
      el('div', { class: 'w-chips' },
        levelBadge(d.niveau),
        d.wortart ? el('span', { class: 'chip-s hi' }, d.wortart) : null,
        d.plural ? el('span', { class: 'chip-s' }, 'çoğul: ' + d.plural) : null,
        d.haeufigkeit ? el('span', { class: 'chip-s' }, d.haeufigkeit) : null,
        d.verb_info?.trennbar === true ? el('span', { class: 'chip-s' }, 'ayrılabilir') : null,
        d.verb_info?.kasus ? el('span', { class: 'chip-s' }, d.verb_info.kasus) : null),
    ),

    // ---- anlam (en önemli kart) ----
    (d.anlam_tr?.length || d.baglam_tr) ? el('div', { class: 'card card-lead' },
      el('div', { class: 'lead-tr' }, (d.anlam_tr || []).join(' · ')),
      d.baglam_tr ? el('div', { class: 'lead-ctx' }, '➜ bu cümlede: ' + d.baglam_tr) : null,
    ) : null,

    // ---- Almanca açıklama ----
    d.erklaerung_de ? card('🇩🇪', `Almanca açıklama · ${getSettings().level}`,
      el('div', { class: 'de-txt' }, d.erklaerung_de),
      el('button', { class: 'row-play', title: 'Dinle', onclick: () => speak(d.erklaerung_de) }, '🔊'),
    ) : null,

    // ---- eş anlamlılar, seviyeye göre ----
    d.synonyme?.length ? card('🔁', 'Yerine kullanabileceklerin',
      el('div', { class: 'syn-list' }, ...d.synonyme.map(s =>
        el('button', { class: 'syn-row', onclick: () => openWord(s.wort, context, source) },
          levelBadge(s.niveau, 'sm') || el('span', { class: 'cefr sm ghost' }, '–'),
          el('span', { class: 'syn-main' },
            el('b', {}, s.wort,
              s.im_satz === true && context ? el('span', { class: 'fits', title: 'Bu cümlede de kullanabilirsin' }, '✓ bu cümlede') : null),
            el('small', {}, [s.tr, s.hinweis].filter(Boolean).join(' — '))),
          el('span', { class: 'syn-go' }, '›')))),
      null, 'En doğal karşılıktan başlayarak sıralı; yanındaki rozet o kelimenin kendi seviyesi.',
    ) : null,

    // ---- kelime ailesi ----
    d.wortfamilie?.length ? card('🌳', 'Kelime ailesi · aynı kökten',
      el('div', { class: 'fam-grid' }, ...d.wortfamilie.map(f =>
        el('button', { class: 'fam-card', onclick: () => openWord(f.wort, '', source) },
          el('span', { class: 'fam-h' }, el('b', {}, f.wort), levelBadge(f.niveau, 'sm')),
          el('small', {}, [f.tr, f.wortart].filter(Boolean).join(' · '))))),
      null, 'Bir tanesine dokunursan onu da öğretirim.',
    ) : null,

    // ---- örnek cümleler ----
    d.beispiele?.length ? card('✍️', 'Örnek cümleler',
      el('div', { class: 'ex-list' }, ...d.beispiele.map((b, i) =>
        el('div', { class: 'ex-row' },
          el('span', { class: 'ex-n' }, String(i + 1)),
          el('div', { class: 'ex-body' },
            el('div', { class: 'ex-de' }, b.de),
            el('div', { class: 'ex-tr' }, b.tr)),
          el('button', { class: 'row-play', title: 'Dinle', onclick: () => speak(b.de) }, '🔊')))),
    ) : null,

    // ---- dilbilgisi ----
    d.verb_info && (d.verb_info.praesens_er || d.verb_info.perfekt) ? card('⚙️', 'Fiil çekimi',
      el('div', { class: 'gram' },
        gramRow('Präsens', d.verb_info.praesens_er),
        gramRow('Präteritum', d.verb_info.praeteritum),
        gramRow('Perfekt', d.verb_info.perfekt)),
    ) : null,

    d.form_erklaerung ? card('🔍', 'Metindeki hâli', el('div', { class: 'note' }, d.form_erklaerung)) : null,

    // ---- zıt anlamlılar ----
    d.gegenteil?.length ? card('↔️', 'Zıt anlamlıları',
      el('div', { class: 'syn-list' }, ...d.gegenteil.map(s =>
        el('button', { class: 'syn-row', onclick: () => openWord(s.wort, context, source) },
          el('span', { class: 'syn-main' }, el('b', {}, s.wort), el('small', {}, s.tr || '')),
          el('span', { class: 'syn-go' }, '›')))),
    ) : null,

    d.tipp ? el('div', { class: 'card card-tip' }, el('span', {}, '💡'), el('div', {}, d.tipp)) : null,

    // ---- geçtiği cümle ----
    context ? card('📖', 'Kitaptaki cümle', ctxBlock(context, d.wort || word)) : null,
  ];

  body().replaceChildren(...nodes.filter(Boolean));
  renderActions(d, word, lemma, artikel, full, context, source);
}

/** Kaydedilmiş kelimenin bilgilerini güncel yanıtla tazeler */
function updateSaved(d, lemma, artikel, source, context) {
  saveWord({
    word: d.wort || lemma, lemma, artikel, wortart: d.wortart || '', niveau: d.niveau || '',
    tr: (d.anlam_tr || []).join(', '),
    de: d.erklaerung_de || '',
    example: d.beispiele?.[0] ? `${d.beispiele[0].de} — ${d.beispiele[0].tr}` : '',
    syn: (d.synonyme || []).map(s => ({ wort: s.wort, tr: s.tr || '', niveau: s.niveau || '', hinweis: s.hinweis || '' })),
    source, context,
  });
}

/** Başlıklı içerik kartı */
function card(icon, title, content, aside = null, foot = null) {
  return el('section', { class: 'card' },
    el('h4', { class: 'card-h' }, el('span', { class: 'card-i' }, icon), title),
    el('div', { class: 'card-b' }, content, aside),
    foot ? el('p', { class: 'card-f' }, foot) : null);
}

const gramRow = (label, value) => value
  ? el('div', { class: 'gram-row' }, el('span', {}, label), el('b', {}, value))
  : null;

/** Panelin altındaki sabit eylem çubuğu */
function renderActions(d, word, lemma, artikel, full, context, source) {
  const bar = $('#word-sheet-actions');
  if (!bar) return;
  const saved = () => !!findVocab(lemma);

  const saveBtn = el('button', { class: 'act' + (saved() ? ' on' : '') },
    el('span', {}, saved() ? '⭐' : '☆'), saved() ? 'Kayıtlı' : 'Kaydet');
  saveBtn.addEventListener('click', () => {
    if (saved()) {
      removeWord(lemma);
      saveBtn.classList.remove('on');
      saveBtn.replaceChildren(el('span', {}, '☆'), document.createTextNode('Kaydet'));
      toast('Kelime defterinden çıkarıldı');
    } else {
      updateSaved(d, lemma, artikel, source, context);
      bumpStat('saves');
      saveBtn.classList.add('on');
      saveBtn.replaceChildren(el('span', {}, '⭐'), document.createTextNode('Kayıtlı'));
      toast('⭐ Kelime defterine eklendi · tekrarlarda karşına çıkacak');
    }
    document.dispatchEvent(new CustomEvent('vocab-changed'));
  });

  bar.replaceChildren(
    saveBtn,
    el('button', { class: 'act', onclick: () => speak(full) }, el('span', {}, '🔊'), 'Dinle'),
    el('button', { class: 'act', onclick: () => openWord(word, context, source, true) }, el('span', {}, '🔄'), 'Yenile'),
    el('button', { class: 'act', onclick: closeSheet }, el('span', {}, '✕'), 'Kapat'),
  );
  bar.hidden = false;
}

/** Bir kelimeyi aç ve yapay zekâdan açıklamasını iste */
export async function openWord(word, context = '', source = '', force = false) {
  word = String(word || '').trim();
  if (!word) return;
  current = { word, context, source };
  openSheet();
  loading(word);
  if (getSettings().autoSpeak) speak(word);
  try {
    const d = await lookupWord(word, context, { force });
    if (!d._cached) bumpStat('lookups');
    if (current && current.word === word) render(d, word, context, source);
  } catch (e) {
    body().replaceChildren(
      el('header', { class: 'w-head' }, el('div', { class: 'w-title' }, el('span', { class: 'w-lemma' }, word))),
      errorBox(e, () => openWord(word, context, source, true)),
    );
  }
}

/** Birden fazla kelimeden oluşan seçim */
export async function openPhrase(phrase, context = '') {
  phrase = String(phrase || '').trim();
  if (!phrase) return;
  const words = tokenize(phrase).filter(t => t.w);
  if (words.length === 1) return openWord(words[0].v, context || phrase);
  openSheet();
  loading(phrase.length > 60 ? phrase.slice(0, 60) + '…' : phrase);
  try {
    const d = await explainPhrase(phrase, context);
    body().replaceChildren(...[
      el('div', { class: 'wh' },
        el('div', { class: 'word', style: 'font-size:20px' }, d.ifade || phrase),
        el('div', { class: 'acts' }, el('button', { class: 'mini', onclick: () => speak(d.ifade || phrase) }, '🔊'))),
      d.tr ? block('Türkçesi', el('div', { class: 'tr-txt' }, d.tr)) : null,
      d.erklaerung_de ? block('Almanca açıklama', el('div', { class: 'de-txt' }, d.erklaerung_de)) : null,
      d.yapisi ? block('Yapısı', el('div', { style: 'font-size:14.5px;color:var(--tx-dim)' }, d.yapisi)) : null,
      d.kelimeler?.length ? block('İçindeki kelimeler',
        el('div', { class: 'syn' }, ...d.kelimeler.map(k =>
          el('button', { onclick: () => openWord(k.wort, phrase) }, el('b', {}, k.wort), el('small', {}, k.tr || ''))))) : null,
      d.beispiele?.length ? block('Örnekler', ...d.beispiele.map(b =>
        el('div', { class: 'ex' }, el('div', { class: 'de-txt' }, b.de), el('div', { class: 'tr-txt' }, b.tr)))) : null,
      d.aehnlich?.length ? block('Benzer ifadeler',
        el('div', { class: 'syn' }, ...d.aehnlich.map(k =>
          el('button', { onclick: () => openPhrase(k.wort) }, el('b', {}, k.wort), el('small', {}, k.tr || ''))))) : null,
      el('div', { style: 'margin-top:16px' }, el('button', { class: 'chip', onclick: closeSheet }, 'Kapat')),
    ].filter(Boolean));
  } catch (e) {
    body().replaceChildren(el('div', { class: 'wh' }, el('div', { class: 'word', style: 'font-size:20px' }, phrase)), errorBox(e));
  }
}

/**
 * Bir kapsayıcıdaki .w kelimelerine dokunma desteği ekler.
 * getContext(spanEl) → kelimenin geçtiği cümleyi döndürmeli.
 */
export function attachWordTaps(container, getContext, source = '') {
  container.addEventListener('click', (e) => {
    const w = e.target.closest('.w');
    if (!w || !container.contains(w)) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim().length > w.textContent.length + 1) return; // seçim yapılıyor
    e.stopPropagation();
    openWord(w.textContent, getContext(w) || '', source);
  });
}
