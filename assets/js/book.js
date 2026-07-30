// Okuyucu: PDF / EPUB / TXT → sayfa sayfa çevrilen kitap + kelimeye dokunma
import { $, el, toast, wordSpans, sentenceAround, hash, normWord } from './util.js';
import { attachWordTaps, openWord, openPhrase } from './word.js';
import { getSettings, setSettings, vocabKeys, putBook, getBook, listBooks, deleteBook, bumpStat } from './store.js';
import { showModal, closeModal } from './ui.js';
import { hardWords } from './ai.js';
import { setReading } from './stats.js';

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs';
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3/dist/jszip.min.js';
const MAX_BLOCKS = 60;   // bir bölüm en fazla bu kadar paragraf tutar (akıcı sayfalama için)
const GAP = 32;

let book = null;         // {id,name,type,chapters:[{title,blocks}],pos}
let chapter = 0, page = 0, pages = 1, pageW = 0;
let wantPage = null, wantT = null;   // yerleşim oturana kadar korunacak hedef sayfa

const flowEl = () => $('#book-flow');
const paperEl = () => $('#paper');

function status(msg, isErr = false) {
  const s = $('#book-status');
  s.className = 'hint' + (isErr ? ' err' : '');
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

/* --------------------------- bölümleri parçalama -------------------------- */
function splitLong(chapters) {
  const out = [];
  for (const ch of chapters) {
    if (ch.blocks.length <= MAX_BLOCKS) { out.push(ch); continue; }
    for (let i = 0; i < ch.blocks.length; i += MAX_BLOCKS) {
      out.push({
        title: i === 0 ? ch.title : `${ch.title} (devam ${Math.floor(i / MAX_BLOCKS) + 1})`,
        blocks: ch.blocks.slice(i, i + MAX_BLOCKS),
      });
    }
  }
  return out;
}

/* ---------------------------------- PDF ---------------------------------- */
async function parsePdf(data, onProgress) {
  const pdfjs = await import(PDFJS_URL);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const chapters = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p, doc.numPages);
    const pg = await doc.getPage(p);
    const tc = await pg.getTextContent();
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
    const blocks = [];
    let para = '', prevY = null, prevH = 12;
    const hs = lines.map(l => l.h).sort((a, b) => a - b);
    const med = hs[Math.floor(hs.length / 2)] || 12;
    for (const ln of lines) {
      const text = ln.parts.join('').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (ln.h >= med * 1.22 && text.length < 90) {           // büyük punto = başlık
        if (para.trim()) { blocks.push({ tag: 'p', text: para.trim() }); para = ''; }
        blocks.push({ tag: 'h3', text });
        prevY = ln.y; prevH = ln.h;
        continue;
      }
      const gap = prevY === null ? 0 : prevY - ln.y;
      const newPara = prevY !== null && (gap > prevH * 1.75 || gap < 0 || Math.abs(ln.h - prevH) > med * 0.3);
      if (newPara && para) { blocks.push({ tag: 'p', text: para.trim() }); para = ''; }
      if (/-$/.test(para)) para = para.slice(0, -1) + text;   // satır sonu tirelemesi
      else para = para ? para + ' ' + text : text;
      prevY = ln.y; prevH = ln.h;
    }
    if (para.trim()) blocks.push({ tag: 'p', text: para.trim() });
    if (blocks.length) chapters.push({ title: `Sayfa ${p}`, blocks });
  }
  if (!chapters.length) throw new Error('PDF içinde metin bulunamadı (taranmış görüntü olabilir).');
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
  const sel = 'h1,h2,h3,h4,p,li,blockquote,dd,td,pre';
  for (let i = 0; i < spine.length; i++) {
    onProgress?.(i + 1, spine.length);
    const path = resolvePath(base, spine[i].href);
    const f = zip.file(path) || zip.file(decodeURIComponent(path));
    if (!f) continue;
    const doc = xmlDoc(await f.async('text'), 'application/xhtml+xml');
    doc.querySelectorAll('script,style,svg,nav').forEach(n => n.remove());
    const blocks = [];
    let title = '';
    const bodyEl = doc.body || doc.documentElement;
    bodyEl.querySelectorAll(sel).forEach(n => {
      if (n.parentElement && n.parentElement.closest(sel)) return;  // iç içe bloklarda tekrarı önle
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
  const isHeading = (t) => t.length <= 70 && !/[.!?:;,»"']$/.test(t) && t.split(' ').length <= 9;
  const blocks = paras.map(t => ({ tag: isHeading(t) ? 'h2' : 'p', text: t }));
  const chapters = [];
  let cur = null;
  for (const b of blocks) {
    if (!cur || (b.tag === 'h2' && cur.blocks.length >= 8)) {
      cur = { title: b.tag === 'h2' ? b.text : `Bölüm ${chapters.length + 1}`, blocks: [] };
      chapters.push(cur);
    }
    cur.blocks.push(b);
  }
  return chapters.length ? chapters : [{ title: 'Metin', blocks: [{ tag: 'p', text }] }];
}

/* ------------------------------- sayfalama -------------------------------- */
let lastW = 0, lastH = 0;

/** Sütunlara akan metnin kaç sayfa ettiğini içeriğin gerçek genişliğinden ölçer */
function measurePages() {
  const flow = flowEl();
  const w = flow.clientWidth, h = flow.clientHeight;
  if (!w || !h) return;
  pageW = w + GAP;
  flow.style.columnWidth = w + 'px';
  flow.style.columnGap = GAP + 'px';
  lastW = w; lastH = h;

  // transform her ikisini de aynı kaydırdığı için göreli ölçüm doğru sonucu verir
  const fr = flow.getBoundingClientRect();
  let maxRight = 0;
  for (const child of flow.children) {
    for (const r of child.getClientRects()) {
      if (r.width || r.height) maxRight = Math.max(maxRight, r.right - fr.left);
    }
  }
  pages = Math.max(1, Math.ceil((maxRight - 1) / pageW));
}

function showPage(i, animate = true) {
  const flow = flowEl();
  page = Math.max(0, Math.min(i, pages - 1));
  if (!animate) flow.classList.add('no-anim');
  flow.style.transform = `translateX(${-page * pageW}px)`;
  if (!animate) requestAnimationFrame(() => flow.classList.remove('no-anim'));
  updateChrome();
  savePos();
}

function updateChrome() {
  if (!book) return;
  const ch = book.chapters[chapter];
  $('#rh-title').textContent = ch.title;
  $('#rh-num').textContent = `${page + 1} / ${pages}`;
  $('#page-foot').textContent = `${chapter + 1}. bölüm · sayfa ${page + 1} / ${pages}`;
  $('#btn-toc').textContent = `${ch.title} · ${page + 1}/${pages}`;
  $('#btn-prev').disabled = chapter === 0 && page === 0;
  $('#btn-next').disabled = chapter >= book.chapters.length - 1 && page >= pages - 1;
  const overall = ((chapter + (pages > 1 ? page / pages : 0)) / book.chapters.length) * 100;
  $('#book-progress').firstElementChild.style.width = Math.min(100, Math.max(0.5, overall)).toFixed(1) + '%';
}

export function nextPage() {
  if (!book) return;
  wantPage = null;
  if (page < pages - 1) { bumpStat('pages'); return showPage(page + 1); }
  if (chapter < book.chapters.length - 1) { bumpStat('pages'); return renderChapter(chapter + 1, 0); }
  toast('Kitabın sonu 🎉');
}
export function prevPage() {
  if (!book) return;
  wantPage = null;
  if (page > 0) return showPage(page - 1);
  if (chapter > 0) return renderChapter(chapter - 1, 'last');
}

/* ------------------------------- gösterim --------------------------------- */
const SERIF = 'Georgia,"Iowan Old Style","Palatino Linotype",Palatino,"Times New Roman",serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif';

export function applyReaderStyle(repaginate = false) {
  const s = getSettings();
  const r = document.documentElement.style;
  r.setProperty('--reader-size', s.fontSize + 'px');
  r.setProperty('--reader-lh', String(s.lineHeight || 1.75));
  r.setProperty('--reader-align', s.justify ? 'justify' : 'left');
  r.setProperty('--reader-font', s.readerFont === 'sans' ? SANS : SERIF);
  paperEl().dataset.theme = s.readerTheme || 'sepia';
  if (repaginate && book) {
    const ratio = pages > 1 ? page / (pages - 1) : 0;
    requestAnimationFrame(() => {
      measurePages();
      showPage(Math.round(ratio * (pages - 1)), false);
    });
  }
}

function renderChapter(idx, toPage = 0) {
  if (!book) return;
  chapter = Math.max(0, Math.min(idx, book.chapters.length - 1));
  const ch = book.chapters[chapter];
  const known = vocabKeys();
  const nodes = [];
  let firstPara = true;
  for (const b of ch.blocks) {
    const n = el(b.tag === 'p' ? 'p' : b.tag);
    if (b.tag === 'p' && firstPara && b.text.length > 60) { n.className = 'chapter-open'; firstPara = false; }
    n.append(wordSpans(b.text));
    for (const w of n.querySelectorAll('.w')) if (known.has(normWord(w.textContent))) w.classList.add('saved');
    nodes.push(n);
  }
  nodes.push(el('p', { class: 'chapter-tail' }, chapter >= book.chapters.length - 1 ? '· son ·' : '· · ·'));

  const flow = flowEl();
  flow.classList.add('no-anim');
  flow.style.transform = 'none';
  flow.replaceChildren(...nodes);
  flow.scrollTop = 0;
  measurePages();
  const target = toPage === 'last' ? pages - 1 : toPage;
  // yeni açılan kitapta yerleşim biraz sonra oturabilir; hedef sayfayı kısa süre koru
  wantPage = target;
  clearTimeout(wantT);
  wantT = setTimeout(() => { wantPage = null; }, 1500);
  showPage(target, false);
}

let saveT = null;
function savePos() {
  if (!book) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    putBook({ ...book, pos: { chapter, page }, opened: Date.now() }).catch(() => {});
  }, 500);
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

function useBook(b) {
  book = b;
  $('#book-empty').hidden = true;
  paperEl().classList.add('on');
  $('#running-head').hidden = false;
  $('#page-foot').hidden = false;
  $('#reader-bar').hidden = false;
  $('#book-progress').hidden = false;
  const title = b.name.replace(/\.(pdf|epub|txt)$/i, '');
  $('#top-title').textContent = title;
  $('#top-title').dataset.book = title;
  setReading(true);
  // çubuklar görünür olduktan sonra yerleşim otursun diye iki kare bekle
  requestAnimationFrame(() => requestAnimationFrame(() =>
    renderChapter(b.pos?.chapter || 0, b.pos?.page || 0)));
}

/** Ekran/kağıt boyu değişince (döndürme, tarayıcı çubuğu, punto) yeniden sayfala */
function relayout() {
  if (!book) return;
  const flow = flowEl();
  if (flow.clientWidth === lastW && flow.clientHeight === lastH) return;
  const ratio = pages > 1 ? page / (pages - 1) : 0;
  const target = wantPage;
  measurePages();
  showPage(target !== null ? target : Math.round(ratio * (pages - 1)), false);
}

/* -------------------------------- dosya aç -------------------------------- */
async function handleFile(file) {
  const name = file.name;
  const ext = (name.split('.').pop() || '').toLowerCase();
  paperEl().classList.remove('on');
  $('#book-empty').hidden = false;
  $('#reader-bar').hidden = true;
  $('#book-progress').hidden = true;
  status(el('span', {}, el('span', { class: 'spinner' }), ` ${name} okunuyor…`));
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
    chapters = splitLong(chapters);
    const b = { id, name, type: ext, chapters, pos: existing?.pos || { chapter: 0, page: 0 }, opened: Date.now() };
    await putBook(b).catch(e => console.warn('kitap kaydedilemedi', e));
    status('');
    useBook(b);
  } catch (e) {
    console.error(e);
    status('Açılamadı: ' + e.message, true);
  }
}

/* -------------------------------- kitaplık -------------------------------- */
async function libraryDialog() {
  const books = await listBooks().catch(() => []);
  const pick = el('label', { class: 'btn primary file-btn', style: 'width:100%' }, '📚 Yeni dosya seç (PDF / EPUB / TXT)');
  const input = el('input', { type: 'file', accept: '.pdf,.epub,.txt,application/pdf,application/epub+zip,text/plain', hidden: true });
  pick.append(input);
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) { closeModal(); handleFile(f); }
  });
  showModal('Kitaplığım', el('div', { class: 'list-lines' },
    pick,
    books.length ? null : el('p', { class: 'hint' }, 'Henüz kitap yok.'),
    ...books.map(b => el('div', { class: 'vrow' },
      el('button', {
        class: 'main', style: 'background:none;border:0;text-align:left',
        onclick: () => { closeModal(); useBook(b); },
      },
        el('div', { class: 'de' }, b.name),
        el('div', { class: 'src' }, `${b.chapters.length} bölüm • ${(b.pos?.chapter || 0) + 1}. bölümde kaldın • ${new Date(b.opened).toLocaleDateString('tr-TR')}`)),
      el('div', { class: 'acts' }, el('button', {
        class: 'mini', title: 'Sil',
        onclick: async (e) => {
          await deleteBook(b.id);
          e.currentTarget.closest('.vrow').remove();
          if (book && book.id === b.id) location.reload();
          toast('Silindi');
        },
      }, '🗑')))),
  ));
}

/* ------------------------------ içindekiler ------------------------------- */
function tocDialog() {
  if (!book) return;
  showModal('İçindekiler', el('div', { class: 'list-lines' },
    ...book.chapters.map((c, i) => el('button', {
      class: 'toc-row' + (i === chapter ? ' on' : ''),
      onclick: () => { closeModal(); renderChapter(i, 0); },
    }, el('span', { class: 'n' }, String(i + 1)), el('span', { class: 't' }, c.title))),
  ));
}

/* ------------------------------ zor kelimeler ----------------------------- */
async function showHardWords() {
  if (!book) return toast('Önce bir kitap aç.');
  const text = book.chapters[chapter].blocks.map(b => b.text).join(' ');
  showModal('Zor kelimeler', el('div', {}, el('p', {}, el('span', { class: 'spinner' }), ' Yapay zeka bu bölümü tarıyor…')));
  try {
    const d = await hardWords(text, { known: [...vocabKeys()].slice(0, 60) });
    const list = d.kelimeler || [];
    showModal('Zor kelimeler', el('div', { class: 'list-lines' },
      list.length ? null : el('p', {}, 'Belirgin zor kelime bulunamadı.'),
      ...list.map(k => el('button', {
        class: 'vrow', style: 'text-align:left',
        onclick: () => { closeModal(); openWord(k.lemma, '', 'kitap: ' + book.name); },
      },
        el('div', { class: 'main' },
          el('div', { class: 'de' }, k.lemma),
          el('div', { class: 'tr' }, k.tr || ''),
          k.warum ? el('div', { class: 'src' }, k.warum) : null))),
    ));
  } catch (e) {
    showModal('Zor kelimeler', el('div', { class: 'err-box' }, e.message));
  }
}

/* ---------------------------- görünüm ayarları ---------------------------- */
function readerOptionsDialog() {
  const s = () => getSettings();
  const wrap = el('div', {});
  const group = (label, ...kids) => el('div', {},
    el('div', { class: 'opt-label' }, label), el('div', { class: 'opt-row' }, ...kids));
  const refresh = () => wrap.querySelectorAll('.opt').forEach(x => x.dispatchEvent(new CustomEvent('refresh')));
  const mk = (text, isOn, onPick) => {
    const b = el('button', { class: 'opt' + (isOn() ? ' on' : '') }, text);
    b.addEventListener('click', () => { onPick(); applyReaderStyle(true); refresh(); });
    b.addEventListener('refresh', () => b.classList.toggle('on', isOn()));
    return b;
  };
  wrap.append(
    group('Tema',
      mk('📜 Kağıt', () => s().readerTheme === 'sepia', () => setSettings({ readerTheme: 'sepia' })),
      mk('☀️ Açık', () => s().readerTheme === 'light', () => setSettings({ readerTheme: 'light' })),
      mk('🌙 Gece', () => s().readerTheme === 'dark', () => setSettings({ readerTheme: 'dark' }))),
    group('Yazı boyutu',
      el('button', { class: 'opt', onclick: () => { setSettings({ fontSize: Math.max(15, s().fontSize - 1) }); applyReaderStyle(true); } }, 'A−'),
      el('button', { class: 'opt', onclick: () => { setSettings({ fontSize: Math.min(30, s().fontSize + 1) }); applyReaderStyle(true); } }, 'A+')),
    group('Yazı tipi',
      mk('Kitap (serif)', () => s().readerFont === 'serif', () => setSettings({ readerFont: 'serif' })),
      mk('Ekran (sans)', () => s().readerFont === 'sans', () => setSettings({ readerFont: 'sans' }))),
    group('Satır aralığı',
      mk('Sık', () => s().lineHeight <= 1.6, () => setSettings({ lineHeight: 1.55 })),
      mk('Normal', () => s().lineHeight > 1.6 && s().lineHeight < 2, () => setSettings({ lineHeight: 1.75 })),
      mk('Geniş', () => s().lineHeight >= 2, () => setSettings({ lineHeight: 2.05 }))),
    group('Hizalama',
      mk('İki yana yasla', () => !!s().justify, () => setSettings({ justify: true })),
      mk('Sola yasla', () => !s().justify, () => setSettings({ justify: false }))),
    el('button', { class: 'btn primary', style: 'width:100%;margin-top:4px', onclick: closeModal }, 'Tamam'),
  );
  showModal('Okuma görünümü', wrap);
}

/* -------------------------------- hareketler ------------------------------ */
function hasSelection() {
  const s = window.getSelection();
  return s && !s.isCollapsed && String(s).trim().length > 1;
}

function initGestures() {
  const paper = paperEl();

  // kenara dokunarak sayfa çevir (kelimeye dokunmak hariç)
  paper.addEventListener('click', (e) => {
    if (!book || e.target.closest('.w') || hasSelection()) return;
    const r = paper.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < r.width * 0.32) prevPage();
    else if (x > r.width * 0.68) nextPage();
  });

  // kaydırarak sayfa çevir
  let x0 = null, y0 = null, t0 = 0;
  paper.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  paper.addEventListener('touchend', (e) => {
    if (x0 === null || !book || hasSelection()) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (Date.now() - t0 > 900) return;                 // uzun basma = seçim
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) nextPage(); else prevPage();
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (!book || !$('#view-book').classList.contains('active')) return;
    if (!$('#modal-backdrop').hidden || !$('#word-sheet').hidden) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); nextPage(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prevPage(); }
  });

  // ekran döndüğünde / boyut değiştiğinde sayfaları yeniden hesapla
  let rT = null;
  const onResize = () => { clearTimeout(rT); rT = setTimeout(relayout, 150); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(paper);

  // birden fazla kelime seçilince "Seçimi açıkla"
  const selBtn = $('#sel-btn');
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    const txt = sel ? String(sel).trim() : '';
    const anchor = sel && sel.anchorNode && (sel.anchorNode.parentElement);
    if (txt.split(/\s+/).length >= 2 && txt.length < 200 && anchor && anchor.closest('#book-flow')) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      selBtn.hidden = false;
      selBtn.style.left = Math.min(Math.max(8, r.left), window.innerWidth - 150) + 'px';
      selBtn.style.top = Math.max(60, r.top - 46) + 'px';
      selBtn.onclick = () => { selBtn.hidden = true; openPhrase(txt); sel.removeAllRanges(); };
    } else selBtn.hidden = true;
  });
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
  $('#btn-reader-opts').addEventListener('click', readerOptionsDialog);
  $('#btn-toc').addEventListener('click', tocDialog);
  $('#btn-hardwords').addEventListener('click', showHardWords);
  $('#btn-prev').addEventListener('click', prevPage);
  $('#btn-next').addEventListener('click', nextPage);

  attachWordTaps(flowEl(), contextOf, 'kitap');
  initGestures();
  document.addEventListener('vocab-changed', () => {
    if (!book) return;
    const known = vocabKeys();
    flowEl().querySelectorAll('.w').forEach(w => w.classList.toggle('saved', known.has(normWord(w.textContent))));
  });

  // en son okunan kitabı aç
  listBooks().then(bs => { if (bs.length) useBook(bs[0]); }).catch(() => {});
}
