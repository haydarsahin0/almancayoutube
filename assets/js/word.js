// Kelime paneli (alttan açılan sayfa)
import { $, el, speak, toast, tokenize } from './util.js';
import { lookupWord, translateSentence, explainPhrase, AIError } from './ai.js';
import { findVocab, saveWord, removeWord, getSettings } from './store.js';

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
  body().replaceChildren(
    el('div', { class: 'wh' }, el('div', { class: 'word' }, title)),
    el('div', { class: 'tags' }, el('span', { class: 'tag' }, 'yapay zeka düşünüyor…')),
    ...[1, 2, 3, 4, 5].map(i => el('div', { class: 'skeleton', style: `width:${[95, 80, 90, 60, 75][i - 1]}%` })),
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

function block(title, ...kids) {
  if (!kids.filter(Boolean).length) return null;
  return el('div', { class: 'blk' }, el('h4', {}, title), ...kids.filter(Boolean));
}

function render(d, word, context, source) {
  const lemma = d.lemma || word;
  const artikel = (d.artikel || '').trim();
  const saved = !!findVocab(lemma);

  const speakBtn = el('button', { class: 'mini', title: 'Seslendir' }, '🔊');
  speakBtn.addEventListener('click', () => speak((artikel ? artikel + ' ' : '') + lemma));

  const saveBtn = el('button', { class: 'mini', title: 'Kelime defterine ekle' }, saved ? '⭐' : '☆');
  saveBtn.addEventListener('click', () => {
    if (findVocab(lemma)) { removeWord(lemma); saveBtn.textContent = '☆'; toast('Kelime defterinden çıkarıldı'); }
    else {
      saveWord({
        word, lemma, artikel, wortart: d.wortart || '',
        tr: (d.anlam_tr || []).join(', '),
        de: d.erklaerung_de || '',
        example: d.beispiele?.[0] ? `${d.beispiele[0].de} — ${d.beispiele[0].tr}` : '',
        source, context,
      });
      saveBtn.textContent = '⭐';
      toast('⭐ Kelime defterine eklendi');
    }
    document.dispatchEvent(new CustomEvent('vocab-changed'));
  });

  const nodes = [
    el('div', { class: 'wh' },
      el('div', {},
        el('div', { class: 'word' }, artikel ? el('span', { class: 'art' }, artikel + ' ') : null, lemma),
        d.wort && d.wort.toLowerCase() !== lemma.toLowerCase()
          ? el('div', { style: 'color:var(--tx-dim);font-size:13.5px;margin-top:2px' }, `metindeki hali: ${d.wort}`) : null,
      ),
      el('div', { class: 'acts' }, speakBtn, saveBtn),
    ),
    el('div', { class: 'tags' },
      d.wortart ? el('span', { class: 'tag hi' }, d.wortart) : null,
      d.plural ? el('span', { class: 'tag' }, 'çoğul: ' + d.plural) : null,
      d.verb_info?.trennbar === true ? el('span', { class: 'tag' }, 'ayrılabilir fiil') : null,
      d.verb_info?.kasus ? el('span', { class: 'tag' }, d.verb_info.kasus) : null,
    ),
    (d.anlam_tr?.length || d.baglam_tr) ? block('Türkçesi',
      d.anlam_tr?.length ? el('div', { class: 'tr-txt' }, d.anlam_tr.join(' • ')) : null,
      d.baglam_tr ? el('div', { style: 'color:var(--tx-dim);font-size:14px;margin-top:5px' }, '➜ bu cümlede: ' + d.baglam_tr) : null,
    ) : null,
    d.erklaerung_de ? block(`Almanca açıklama (${getSettings().level})`,
      el('div', { class: 'de-txt' }, d.erklaerung_de,
        el('button', { class: 'mini', style: 'margin-left:8px', onclick: () => speak(d.erklaerung_de) }, '🔊')),
    ) : null,
    d.form_erklaerung ? block('Cümledeki hali', el('div', { style: 'font-size:14.5px;color:var(--tx-dim)' }, d.form_erklaerung)) : null,
    d.synonyme?.length ? block('Eş anlamlıları (yerine kullanabilirsin)',
      el('div', { class: 'syn' }, ...d.synonyme.map(s =>
        el('button', { onclick: () => openWord(s.wort, context, source) },
          el('b', {}, s.wort), el('small', {}, [s.tr, s.hinweis].filter(Boolean).join(' — '))))),
    ) : null,
    d.gegenteil?.length ? block('Zıt anlamlıları',
      el('div', { class: 'syn' }, ...d.gegenteil.map(s =>
        el('button', { onclick: () => openWord(s.wort, context, source) }, el('b', {}, s.wort), el('small', {}, s.tr || '')))),
    ) : null,
    d.beispiele?.length ? block('Örnek cümleler', ...d.beispiele.map(b =>
      el('div', { class: 'ex' },
        el('div', { class: 'de-txt' }, b.de, el('button', { class: 'mini', style: 'margin-left:6px', onclick: () => speak(b.de) }, '🔊')),
        el('div', { class: 'tr-txt' }, b.tr)),
    )) : null,
    d.verb_info && (d.verb_info.praesens_er || d.verb_info.perfekt) ? block('Fiil bilgisi',
      el('div', { style: 'font-size:14.5px;line-height:1.8' },
        d.verb_info.praesens_er ? el('div', {}, 'Präsens: ' + d.verb_info.praesens_er) : null,
        d.verb_info.praeteritum ? el('div', {}, 'Präteritum: ' + d.verb_info.praeteritum) : null,
        d.verb_info.perfekt ? el('div', {}, 'Perfekt: ' + d.verb_info.perfekt) : null),
    ) : null,
    d.tipp ? block('İpucu', el('div', { style: 'font-size:14.5px' }, '💡 ' + d.tipp)) : null,
    ctxBlock(context, d.wort || word),
    el('div', { style: 'display:flex;gap:8px;margin-top:16px' },
      el('button', { class: 'chip', onclick: () => openWord(word, context, source, true) }, '🔄 Yeniden sor'),
      el('button', { class: 'chip', onclick: closeSheet }, 'Kapat'),
    ),
  ];
  body().replaceChildren(...nodes.filter(Boolean));
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
    if (current && current.word === word) render(d, word, context, source);
  } catch (e) {
    body().replaceChildren(
      el('div', { class: 'wh' }, el('div', { class: 'word' }, word)),
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
