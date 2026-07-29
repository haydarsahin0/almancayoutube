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
    for (const ln of lines) {
      const text = ln.parts.join('').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const gap = prevY === null ? 0 : prevY - ln.y;
      const newPara = prevY !== null && (gap > prevH * 1.75 || gap < 0);
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
  const chapters = [];
  const PER = 40;
  for (let i = 0; i < paras.length; i += PER) {
    chapters.push({
      title: `Bölüm ${chapters.length + 1}`,
      blocks: paras.slice(i, i + PER).map(t => ({ tag: 'p', text: t })),
    });
  }
  return chapters.length ? chapters : [{ title: 'Metin', blocks: [{ tag: 'p', text }] }];
}

/* -------------------------------- gösterim -------------------------------- */
function renderChapter(idx, scrollTo = 0) {
  if (!book) return;
  chapter = Math.max(0, Math.min(idx, book.chapters.length - 1));
  const ch = book.chapters[chapter];
  const box = $('#book-content');
  const known = vocabKeys();
  const nodes = ch.blocks.map(b => {
    const n = el(b.tag === 'p' ? 'p' : b.tag);
    n.append(wordSpans(b.text));
    for (const w of n.querySelectorAll('.w')) if (known.has(normWord(w.textContent))) w.classList.add('saved');
    return n;
  });
  nodes.push(el('div', { class: 'page-mark' }, `— ${ch.title} (${chapter + 1}/${book.chapters.length}) —`));
  box.replaceChildren(...nodes);
  $('#book-chapter').value = String(chapter);
  window.scrollTo({ top: scrollTo || 0, behavior: 'auto' });
  book.pos = { chapter, scroll: 0 };
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

/* -------------------------------- kurulum --------------------------------- */
export function initBook() {
  document.documentElement.style.setProperty('--reader-size', getSettings().fontSize + 'px');

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
  const setFont = (d) => {
    const s = Math.max(14, Math.min(30, getSettings().fontSize + d));
    setSettings({ fontSize: s });
    document.documentElement.style.setProperty('--reader-size', s + 'px');
  };
  $('#btn-font-plus').addEventListener('click', () => setFont(1));
  $('#btn-font-minus').addEventListener('click', () => setFont(-1));

  attachWordTaps($('#book-content'), contextOf, 'kitap');
  window.addEventListener('scroll', () => { if (book && $('#view-book').classList.contains('active')) savePos(); }, { passive: true });

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
