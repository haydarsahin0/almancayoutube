// Kitap görünümü: PDF / EPUB / TXT okuma + kelimeye dokunma
import { $, el, toast, wordSpans, sentenceAround, hash, normWord } from './util.js';
import { attachWordTaps } from './word.js';
import { getSettings, setSettings, vocabKeys, putBook, getBook, listBooks, deleteBook } from './store.js';
import { showModal, closeModal } from './ui.js';
import { showHardWords } from './video.js';

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs';
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3/dist/jszip.min.js';

let book = null;     // {id,name,type,chapters:[{title,blocks:[{tag,text}]}],pos}
let chapter = 0;

function status(msg, isErr = false) {
  const s = $('#book-status');
  s.className = 'status' + (isErr ? ' err' : '');
  s.replaceChildren();
  if (msg) s.append(msg.nodeType ? msg : document.createTextNode(msg));
}

function loadScript(url) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some(s => s.src === url)) return res();
    const s = document.createElement('script');
    s.src = url; s.onload = () => res(); s.onerror = () => rej(new Error('Kütüphane yüklenemedi: ' + url));
    document.head.append(s);
  });
}

/* ---------------------------------- PDF ---------------------------------- */
async function parsePdf(data, onProgress) {
  const pdfjs = await import(PDFJS_URL);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const chapters = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // satırları y konumuna göre grupla
    const lines = [];
    let cur = null;
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      const h = Math.abs(it.transform[3]) || 12;
      if (!cur || Math.abs(cur.y - y) > h * 0.6) {
        cur = { y, h, parts: [it.str] };
        lines.push(cur);
      } else {
        const prev = cur.parts[cur.parts.length - 1] || '';
        cur.parts.push(/\s$/.test(prev) || /^\s/.test(it.str) ? it.str : ' ' + it.str);
      }
      if (it.hasEOL) cur = null;
    }
    // satırları paragraflara çevir
    const blocks = [];
    let para = '';
    let prevY = null, prevH = 12;
    const hs = lines.map(l => l.h).sort((a, b) => a - b);
    const med = hs[Math.floor(hs.length / 2)] || 12;
    for (const ln of lines) {
      const text = ln.parts.join('').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      // büyük puntolu kısa satırlar = başlık
      if (ln.h >= med * 1.22 && text.length < 90) {
        if (para.trim()) { blocks.push({ tag: 'p', text: para.trim() }); para = ''; }
        blocks.push({ tag: 'h3', text });
        prevY = ln.y; prevH = ln.h;
        continue;
      }
      const gap = prevY === null ? 0 : prevY - ln.y;
      const newPara = prevY !== null && (gap > prevH * 1.75 || gap < 0 || Math.abs(ln.h - prevH) > med * 0.3);
      if (newPara && para) { blocks.push({ tag: 'p', text: para.trim() }); para = ''; }
      if (/-$/.test(para)) para = para.slice(0, -1) + text;      // satır sonu tirelemesi
      else para = para ? para + ' ' + text : text;
      prevY = ln.y; prevH = ln.h;
    }
    if (para.trim()) blocks.push({ tag: 'p', text: para.trim() });
    chapters.push({ title: `Sayfa ${p}`, blocks });
  }
  return chapters;
}

/* ---------------------------------- EPUB --------------------------------- */
function xmlDoc(text, type = 'application/xml') {
  const d = new DOMParser().parseFromString(text, type);
  return d.querySelector('parsererror') ? new DOMParser().parseFromString(text, 'text/html') : d;
}
const dirOf = (p) => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
function resolvePath(base, href) {
  const url = new URL(href.split('#')[0], 'file:///' + base);
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

async function parseEpub(arrayBuffer, onProgress) {
  await loadScript(JSZIP_URL);
  const zip = await window.JSZip.loadAsync(arrayBuffer);
  if (zip.file('META-INF/encryption.xml')) throw new Error('Bu EPUB kopya korumalı (DRM) — açılamıyor.');
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('Geçerli bir EPUB dosyası değil.');
  const container = xmlDoc(await containerFile.async('text'));
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB içeriği okunamadı.');
  const opf = xmlDoc(await zip.file(opfPath).async('text'));
  const base = dirOf(opfPath);

  const manifest = {};
  opf.querySelectorAll('manifest > item').forEach(i => {
    manifest[i.getAttribute('id')] = { href: i.getAttribute('href'), type: i.getAttribute('media-type') || '' };
  });
  const spine = [...opf.querySelectorAll('spine > itemref')]
    .map(r => manifest[r.getAttribute('idref')])
    .filter(m => m && /html/i.test(m.type));

  const chapters = [];
  for (let i = 0; i < spine.length; i++) {
    onProgress?.(i + 1, spine.length);
    const path = resolvePath(base, spine[i].href);
    const f = zip.file(path) || zip.file(decodeURIComponent(path));
    if (!f) continue;
    const doc = xmlDoc(await f.async('text'), 'application/xhtml+xml');
    doc.querySelectorAll('script,style,svg,nav[epub\\:type=toc]').forEach(n => n.remove());
    const blocks = [];
    let title = '';
    const bodyEl = doc.body || doc.documentElement;
    const sel = 'h1,h2,h3,h4,p,li,blockquote,dd,td,pre';
    bodyEl.querySelectorAll(sel).forEach(n => {
      if (n.parentElement && n.parentElement.closest(sel)) return; // iç içe bloklarda metin tekrarını önle
      const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const tag = /^h[1-4]$/i.test(n.tagName) ? 'h' + Math.min(3, Number(n.tagName[1])) : 'p';
      if (!title && tag.startsWith('h')) title = text.slice(0, 60);
      blocks.push({ tag, text });
    });
    if (!blocks.length) {
      const t = (bodyEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) blocks.push({ tag: 'p', text: t });
    }
    if (blocks.length) chapters.push({ title: title || `Bölüm ${chapters.length + 1}`, blocks });
  }
  if (!chapters.length) throw new Error('EPUB içinde okunabilir metin bulunamadı.');
  return chapters;
}

/* ---------------------------------- TXT ---------------------------------- */
function parseTxt(text) {
  const paras = text.replace(/\r/g, '').split(/\n\s*\n/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean);
  // kısa, noktalama ile bitmeyen satırlar başlıktır (Kapitel 1, bölüm adları…)
  const isHeading = (t) => t.length <= 70 && !/[.!?:;,»"']$/.test(t) && t.split(' ').length <= 9;
  const blocks = paras.map(t => ({ tag: isHeading(t) ? 'h2' : 'p', text: t }));

  const chapters = [];
  let cur = null;
  const push = (title) => { cur = { title: title || `Bölüm ${chapters.length + 1}`, blocks: [] }; chapters.push(cur); };
  for (const b of blocks) {
    const long = cur && cur.blocks.length >= 12;
    if (!cur || (b.tag === 'h2' && long) || cur.blocks.length >= 45) push(b.tag === 'h2' ? b.text : '');
    cur.blocks.push(b);
    if (cur.blocks.length === 1 && b.tag === 'h2') cur.title = b.text;
  }
  return chapters.length ? chapters : [{ title: 'Metin', blocks: [{ tag: 'p', text }] }];
}

/* -------------------------------- gösterim -------------------------------- */
const SERIF = 'Georgia,"Iowan Old Style","Palatino Linotype",Palatino,"Times New Roman",serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif';

export function applyReaderStyle() {
  const s = getSettings();
  const r = document.documentElement.style;
  r.setProperty('--reader-size', s.fontSize + 'px');
  r.setProperty('--reader-lh', String(s.lineHeight || 1.78));
  r.setProperty('--reader-align', s.justify ? 'justify' : 'left');
  r.setProperty('--reader-font', s.readerFont === 'sans' ? SANS : SERIF);
  const box = $('#book-content');
  if (box) box.dataset.theme = s.readerTheme || 'sepia';
}

function updateProgress() {
  const bar = $('#book-progress');
  if (!book) { bar.hidden = true; return; }
  bar.hidden = false;
  const box = $('#book-content');
  const h = Math.max(1, box.scrollHeight - window.innerHeight);
  const within = Math.min(1, Math.max(0, (window.scrollY - box.offsetTop + 120) / h));
  const pct = ((chapter + within) / book.chapters.length) * 100;
  bar.firstElementChild.style.width = Math.min(100, Math.max(0.5, pct)).toFixed(1) + '%';
}

function renderChapter(idx, scrollTo = 0) {
  if (!book) return;
  chapter = Math.max(0, Math.min(idx, book.chapters.length - 1));
  const ch = book.chapters[chapter];
  const box = $('#book-content');
  const known = vocabKeys();

  const nodes = [el('div', { class: 'running-head' },
    el('span', { class: 'rh-t' }, book.name.replace(/\.(pdf|epub|txt)$/i, '')),
    el('span', {}, `${chapter + 1} / ${book.chapters.length}`))];

  let firstPara = true;
  for (const b of ch.blocks) {
    const n = el(b.tag === 'p' ? 'p' : b.tag);
    if (b.tag === 'p' && firstPara && b.text.length > 60) { n.className = 'chapter-open'; firstPara = false; }
    n.append(wordSpans(b.text));
    for (const w of n.querySelectorAll('.w')) if (known.has(normWord(w.textContent))) w.classList.add('saved');
    nodes.push(n);
  }

  nodes.push(el('div', { class: 'page-mark' }, ch.title));
  nodes.push(el('div', { class: 'chapter-end' },
    el('button', { disabled: chapter === 0 || null, onclick: () => renderChapter(chapter - 1) }, '‹ Önceki'),
    el('button', { disabled: chapter >= book.chapters.length - 1 || null, onclick: () => renderChapter(chapter + 1) }, 'Sonraki ›')));

  box.replaceChildren(...nodes);
  $('#book-chapter').value = String(chapter);
  $('#btn-prev-page').disabled = chapter === 0;
  $('#btn-next-page').disabled = chapter >= book.chapters.length - 1;
  window.scrollTo({ top: scrollTo || 0, behavior: 'auto' });
  book.pos = { chapter, scroll: 0 };
  updateProgress();
  savePos();
}

let saveT = null;
function savePos() {
  if (!book) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    putBook({ ...book, pos: { chapter, scroll: window.scrollY }, opened: Date.now() }).catch(() => {});
  }, 700);
}

function contextOf(spanEl) {
  const blk = spanEl.closest('p,h1,h2,h3,li,blockquote');
  if (!blk) return '';
  const full = blk.textContent || '';
  if (full.length < 300) return full.trim();
  let idx = 0;
  for (const node of blk.childNodes) {
    if (node === spanEl) break;
    idx += (node.textContent || '').length;
  }
  return sentenceAround(full, idx) || full.slice(0, 300);
}

function setupNav() {
  const sel = $('#book-chapter');
  sel.replaceChildren(...book.chapters.map((c, i) => el('option', { value: String(i) }, `${i + 1}. ${c.title}`)));
  sel.onchange = () => renderChapter(Number(sel.value));
  $('#book-nav').hidden = false;
}

async function useBook(b, restore = true) {
  book = b;
  setupNav();
  renderChapter(restore ? (b.pos?.chapter || 0) : 0);
  if (restore && b.pos?.scroll) setTimeout(() => window.scrollTo({ top: b.pos.scroll }), 60);
  status(`${b.name} • ${b.chapters.length} ${b.type === 'pdf' ? 'sayfa' : 'bölüm'} • kelimeye dokun`);
}

/* -------------------------------- dosya aç -------------------------------- */
async function handleFile(file) {
  const name = file.name;
  const ext = (name.split('.').pop() || '').toLowerCase();
  status(el('span', {}, el('span', { class: 'spinner' }), ` ${name} okunuyor…`));
  $('#book-content').replaceChildren(el('div', { class: 'empty-state' }, el('div', { class: 'big' }, '⏳'), el('p', {}, 'Dosya işleniyor, biraz sürebilir…')));
  try {
    const buf = await file.arrayBuffer();
    const id = hash(name + ':' + file.size);
    const existing = await getBook(id).catch(() => null);
    let chapters;
    if (existing?.chapters?.length) {
      chapters = existing.chapters;
    } else if (ext === 'pdf') {
      chapters = await parsePdf(new Uint8Array(buf), (p, t) => status(el('span', {}, el('span', { class: 'spinner' }), ` PDF çözümleniyor… ${p}/${t} sayfa`)));
    } else if (ext === 'epub') {
      chapters = await parseEpub(buf, (p, t) => status(el('span', {}, el('span', { class: 'spinner' }), ` EPUB çözümleniyor… ${p}/${t} bölüm`)));
    } else {
      chapters = parseTxt(new TextDecoder('utf-8').decode(buf));
    }
    const b = { id, name, type: ext, chapters, pos: existing?.pos || { chapter: 0, scroll: 0 }, opened: Date.now() };
    await putBook(b).catch(e => console.warn('kitap kaydedilemedi', e));
    await useBook(b, !!existing);
  } catch (e) {
    console.error(e);
    status('Açılamadı: ' + e.message, true);
    $('#book-content').replaceChildren(el('div', { class: 'err-box' }, 'Dosya açılamadı: ' + e.message));
  }
}

/* -------------------------------- kitaplık -------------------------------- */
async function libraryDialog() {
  const books = await listBooks().catch(() => []);
  showModal('Kitaplığım', el('div', { class: 'list-lines' },
    books.length ? null : el('p', { class: 'hint' }, 'Henüz kitap yok. Yukarıdan bir dosya seç.'),
    ...books.map(b => el('div', { class: 'vrow' },
      el('button', {
        class: 'main', style: 'background:none;border:0;text-align:left',
        onclick: async () => { closeModal(); await useBook(b); },
      },
        el('div', { class: 'de' }, b.name),
        el('div', { class: 'src' }, `${b.chapters.length} ${b.type === 'pdf' ? 'sayfa' : 'bölüm'} • en son ${new Date(b.opened).toLocaleDateString('tr-TR')}`)),
      el('div', { class: 'acts' }, el('button', {
        class: 'mini', title: 'Sil',
        onclick: async (e) => { await deleteBook(b.id); e.currentTarget.closest('.vrow').remove(); toast('Silindi'); },
      }, '🗑')))),
  ));
}

/* ---------------------------- görünüm ayarları ---------------------------- */
function readerOptionsDialog() {
  const s = () => getSettings();
  const wrap = el('div', {});

  const group = (label, ...kids) => el('div', {},
    el('div', { class: 'opt-label' }, label), el('div', { class: 'opt-row' }, ...kids));

  const mk = (text, isOn, onPick) => {
    const b = el('button', { class: 'opt' + (isOn() ? ' on' : '') }, text);
    b.addEventListener('click', () => {
      onPick();
      applyReaderStyle();
      wrap.querySelectorAll('.opt').forEach(x => x.dispatchEvent(new CustomEvent('refresh')));
      if (book) renderChapter(chapter, window.scrollY);
    });
    b.addEventListener('refresh', () => b.classList.toggle('on', isOn()));
    return b;
  };

  wrap.append(
    group('Tema',
      mk('📜 Kağıt', () => s().readerTheme === 'sepia', () => setSettings({ readerTheme: 'sepia' })),
      mk('☀️ Açık', () => s().readerTheme === 'light', () => setSettings({ readerTheme: 'light' })),
      mk('🌙 Gece', () => s().readerTheme === 'dark', () => setSettings({ readerTheme: 'dark' }))),
    group('Yazı boyutu',
      el('button', { class: 'opt', onclick: () => { setSettings({ fontSize: Math.max(15, s().fontSize - 1) }); applyReaderStyle(); } }, 'A−'),
      el('button', { class: 'opt', onclick: () => { setSettings({ fontSize: Math.min(30, s().fontSize + 1) }); applyReaderStyle(); } }, 'A+')),
    group('Yazı tipi',
      mk('Kitap (serif)', () => s().readerFont === 'serif', () => setSettings({ readerFont: 'serif' })),
      mk('Ekran (sans)', () => s().readerFont === 'sans', () => setSettings({ readerFont: 'sans' }))),
    group('Satır aralığı',
      mk('Sık', () => s().lineHeight <= 1.6, () => setSettings({ lineHeight: 1.6 })),
      mk('Normal', () => s().lineHeight > 1.6 && s().lineHeight < 2, () => setSettings({ lineHeight: 1.78 })),
      mk('Geniş', () => s().lineHeight >= 2, () => setSettings({ lineHeight: 2.05 }))),
    group('Hizalama',
      mk('İki yana yasla', () => !!s().justify, () => setSettings({ justify: true })),
      mk('Sola yasla', () => !s().justify, () => setSettings({ justify: false }))),
    el('button', { class: 'btn primary', style: 'width:100%;margin-top:4px', onclick: closeModal }, 'Tamam'),
  );
  showModal('Okuma görünümü', wrap);
}

/* -------------------------------- kurulum --------------------------------- */
export function initBook() {
  applyReaderStyle();

  $('#book-file').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  });
  $('#btn-book-lib').addEventListener('click', libraryDialog);
  $('#btn-prev-page').addEventListener('click', () => renderChapter(chapter - 1));
  $('#btn-next-page').addEventListener('click', () => renderChapter(chapter + 1));
  $('#btn-book-hardwords').addEventListener('click', () => {
    if (!book) return toast('Önce bir kitap aç.');
    showHardWords(book.chapters[chapter].blocks.map(b => b.text).join(' '), 'kitap: ' + book.name);
  });
  $('#btn-reader-opts').addEventListener('click', readerOptionsDialog);

  attachWordTaps($('#book-content'), contextOf, 'kitap');
  window.addEventListener('scroll', () => {
    if (book && $('#view-book').classList.contains('active')) { savePos(); updateProgress(); }
  }, { passive: true });

  // son okunan kitabı hatırlat
  listBooks().then(bs => {
    if (!bs.length) return;
    const b = bs[0];
    $('#book-content').replaceChildren(el('div', { class: 'empty-state' },
      el('div', { class: 'big' }, '📖'),
      el('p', {}, 'Kaldığın yerden devam edebilirsin.'),
      el('button', { class: 'btn primary', onclick: () => useBook(b) }, '▶︎ ' + b.name),
      el('p', { class: 'hint', style: 'margin-top:18px' }, 'Ya da yukarıdan yeni bir PDF / EPUB / TXT yükle.'),
    ));
  }).catch(() => {});
}
