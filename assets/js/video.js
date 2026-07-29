// Video görünümü: oynatıcı + senkron transkript
import { $, el, fmtTime, toast, wordSpans, normWord } from './util.js';
import { attachWordTaps, openWord, openPhrase } from './word.js';
import { getSettings, setSettings, vocabKeys } from './store.js';
import { hardWords } from './ai.js';
import {
  parseVideoId, getTranscript, getVideoInfo, searchVideos,
  CHANNELS, channelVideos, parseManualTranscript, parseSrtVtt,
} from './youtube.js';
import { showModal, closeModal } from './ui.js';

let player = null, ready = false, timer = null;
let cues = [], cueEls = [], activeIdx = -1;
let videoId = null, videoTitle = '';
const LAST_KEY = 'dl.lastVideo';

/* ------------------------------- oynatıcı --------------------------------- */
function loadApi() {
  return new Promise((res) => {
    if (window.YT && window.YT.Player) return res();
    window.onYouTubeIframeAPIReady = () => res();
    if (!document.getElementById('yt-api')) {
      const s = document.createElement('script');
      s.id = 'yt-api'; s.src = 'https://www.youtube.com/iframe_api';
      document.head.append(s);
    }
  });
}

async function ensurePlayer() {
  await loadApi();
  if (player) return player;
  await new Promise((res) => {
    player = new YT.Player('ytplayer', {
      playerVars: { rel: 0, playsinline: 1, modestbranding: 1, hl: 'de' },
      events: { onReady: () => { ready = true; res(); } },
    });
  });
  return player;
}

export function seekTo(sec) {
  if (player && ready) { player.seekTo(Math.max(0, sec), true); player.playVideo(); }
}
export function pauseVideo() { try { if (player && ready) player.pauseVideo(); } catch {} }

/* ------------------------------- transkript ------------------------------- */
function status(msg, isErr = false) {
  const s = $('#transcript-status');
  s.className = 'status' + (isErr ? ' err' : '');
  s.replaceChildren();
  if (msg) s.append(msg.nodeType ? msg : document.createTextNode(msg));
}

/** kısa altyazı parçalarını okunabilir cümlelere birleştirir */
function groupCues(list) {
  const out = [];
  let cur = null;
  for (const c of list) {
    const t = c.text.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (!cur) { cur = { start: c.start, end: c.start + (c.dur || 2), text: t }; continue; }
    const merged = (cur.text + ' ' + t).trim();
    const endsSentence = /[.!?…:]["»)]?$/.test(cur.text);
    if (merged.length > 150 || endsSentence || c.start - cur.end > 2.2) {
      out.push(cur);
      cur = { start: c.start, end: c.start + (c.dur || 2), text: t };
    } else {
      cur.text = merged;
      cur.end = c.start + (c.dur || 2);
    }
  }
  if (cur) out.push(cur);
  return out;
}

function renderTranscript() {
  const box = $('#transcript');
  box.replaceChildren();
  cueEls = [];
  const known = vocabKeys();
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const tx = el('div', { class: 'tx' });
    tx.append(wordSpans(c.text));
    for (const w of tx.querySelectorAll('.w')) if (known.has(normWord(w.textContent))) w.classList.add('saved');
    const row = el('div', { class: 'cue', dataset: { i } },
      el('button', { class: 't', title: 'Buraya atla', onclick: () => seekTo(c.start) }, fmtTime(c.start)),
      tx);
    box.append(row);
    cueEls.push(row);
  }
}

function contextOf(spanEl) {
  const cue = spanEl.closest('.cue');
  const i = cue ? Number(cue.dataset.i) : -1;
  if (i < 0 || !cues[i]) return spanEl.closest('.tx')?.textContent?.trim() || '';
  const parts = [cues[i - 1]?.text, cues[i]?.text, cues[i + 1]?.text].filter(Boolean);
  return parts.join(' ').slice(0, 400);
}

function tick() {
  if (!player || !ready || !cues.length) return;
  let t;
  try { t = player.getCurrentTime(); } catch { return; }
  let lo = 0, hi = cues.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx === activeIdx) return;
  if (cueEls[activeIdx]) cueEls[activeIdx].classList.remove('active');
  activeIdx = idx;
  const node = cueEls[idx];
  if (!node) return;
  node.classList.add('active');
  if (getSettings().autoscroll && $('#word-sheet').hidden) {
    const r = node.getBoundingClientRect();
    if (r.top < 120 || r.bottom > window.innerHeight - 80) {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

/* -------------------------------- video aç -------------------------------- */
export async function openVideo(id, title = '') {
  videoId = id; videoTitle = title;
  localStorage.setItem(LAST_KEY, JSON.stringify({ id, title }));
  $('#player-empty').hidden = true;
  $('.player-box').classList.add('on');
  document.querySelector('[data-sub="transcript"]').click();
  await ensurePlayer();
  player.loadVideoById(id);
  if (!timer) timer = setInterval(tick, 300);

  cues = []; activeIdx = -1;
  $('#transcript').replaceChildren();
  status(el('span', {}, el('span', { class: 'spinner' }), 'Altyazı aranıyor…'));

  if (!title) { getVideoInfo(id).then(i => { if (i.title) { videoTitle = i.title; } }); }

  try {
    const prefer = $('#transcript-lang').value;
    const { track, cues: raw } = await getTranscript(id, prefer);
    cues = groupCues(raw);
    renderTranscript();
    status(`${track.name}${track.asr ? ' (otomatik)' : ''} • ${cues.length} satır • kelimeye dokun`);
  } catch (e) {
    status(el('span', {}, e.message + ' ',
      el('button', { class: 'chip', style: 'margin-left:6px', onclick: manualTranscriptDialog }, '📋 Elle ekle')), true);
  }
}

/* --------------------------- elle transkript ekleme ------------------------ */
function manualTranscriptDialog() {
  const ta = el('textarea', { placeholder: '0:00 Hallo und herzlich willkommen…\n0:06 Heute sprechen wir über…' });
  const file = el('input', { type: 'file', accept: '.srt,.vtt,.txt' });
  showModal('Transkripti elle ekle', el('div', {},
    el('p', { class: 'hint', style: 'margin-top:0' },
      'YouTube uygulamasında videonun altındaki açıklamayı aç → "Transkripti göster" → metni kopyala ve buraya yapıştır. ' +
      'Zaman damgası olmasa da olur (o zaman senkron çalışmaz). .srt / .vtt dosyası da yükleyebilirsin.'),
    ta,
    el('div', { style: 'margin:10px 0' }, file),
    el('div', { style: 'display:flex;gap:8px' },
      el('button', {
        class: 'btn primary grow', onclick: () => {
          const c = parseManualTranscript(ta.value);
          if (!c.length) return toast('Metin boş görünüyor.');
          cues = groupCues(c); activeIdx = -1; renderTranscript();
          status(`Elle eklenen transkript • ${cues.length} satır`);
          closeModal();
        },
      }, 'Kullan'),
      el('button', { class: 'btn', onclick: closeModal }, 'Vazgeç')),
  ));
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; if (!f) return;
    const txt = await f.text();
    const c = /-->/.test(txt) ? parseSrtVtt(txt) : parseManualTranscript(txt);
    if (!c.length) return toast('Dosya okunamadı.');
    cues = groupCues(c); activeIdx = -1; renderTranscript();
    status(`${f.name} • ${cues.length} satır`);
    closeModal();
  });
}

/* ------------------------------ zor kelimeler ----------------------------- */
async function showHardWords(text, source) {
  if (!text.trim()) return toast('Önce bir metin/transkript yükle.');
  showModal('Zor kelimeler', el('div', {}, el('p', {}, el('span', { class: 'spinner' }), ' Yapay zeka metni tarıyor…')));
  try {
    const d = await hardWords(text, { known: [...vocabKeys()].slice(0, 60) });
    const list = d.kelimeler || [];
    showModal('Zor kelimeler', el('div', { class: 'list-lines' },
      list.length ? null : el('p', {}, 'Belirgin zor kelime bulunamadı.'),
      ...list.map(k => el('button', {
        class: 'vrow', style: 'text-align:left',
        onclick: () => { closeModal(); openWord(k.lemma, '', source); },
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

/* ------------------------------ video listesi ----------------------------- */
function videoCard(v) {
  return el('button', { class: 'vcard', onclick: () => openVideo(v.id, v.title) },
    el('img', { src: v.thumb, alt: '', loading: 'lazy' }),
    el('div', { class: 'meta' },
      el('div', { class: 'ttl' }, v.title),
      el('div', { class: 'sub' }, [v.author, v.length].filter(Boolean).join(' • '))),
  );
}

function listStatus(msg, isErr = false) {
  $('#video-list').replaceChildren(el('div', { class: 'status' + (isErr ? ' err' : ''), style: 'padding:14px 2px' },
    isErr ? msg : el('span', {}, el('span', { class: 'spinner' }), ' ' + msg)));
}

async function showChannel(ch, btn) {
  document.querySelectorAll('#channel-chips .chip').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  listStatus(`${ch.name} videoları yükleniyor…`);
  try {
    const vids = await channelVideos(ch);
    $('#video-list').replaceChildren(...vids.map(videoCard));
    if (!vids.length) listStatus('Video bulunamadı.', true);
  } catch (e) {
    listStatus('Yüklenemedi: ' + e.message, true);
  }
}

async function doSearch(q) {
  listStatus(`"${q}" aranıyor…`);
  try {
    const vids = await searchVideos(q);
    $('#video-list').replaceChildren(...vids.map(videoCard));
    if (!vids.length) listStatus('Sonuç yok.', true);
  } catch (e) {
    listStatus('Arama yapılamadı: ' + e.message, true);
  }
}

/* --------------------------------- kurulum -------------------------------- */
export function initVideo() {
  // alt sekmeler
  document.querySelectorAll('#video-subtabs .sub-tab').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#video-subtabs .sub-tab').forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll('#view-video .sub-view').forEach(v => v.classList.toggle('active', v.id === 'sub-' + b.dataset.sub));
    });
  });

  attachWordTaps($('#transcript'), contextOf, 'video');

  $('#btn-autoscroll').addEventListener('click', (e) => {
    const on = !getSettings().autoscroll;
    setSettings({ autoscroll: on });
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? '🔁 Takip: Açık' : '🔁 Takip: Kapalı';
  });
  const as = getSettings().autoscroll;
  $('#btn-autoscroll').setAttribute('aria-pressed', String(as));
  $('#btn-autoscroll').textContent = as ? '🔁 Takip: Açık' : '🔁 Takip: Kapalı';

  $('#btn-transcript-manual').addEventListener('click', manualTranscriptDialog);
  $('#btn-hardwords').addEventListener('click', () => showHardWords(cues.map(c => c.text).join(' '), 'video'));
  $('#transcript-lang').addEventListener('change', () => { if (videoId) openVideo(videoId, videoTitle); });

  const go = () => {
    const raw = $('#yt-input').value.trim();
    if (!raw) return;
    const id = parseVideoId(raw);
    if (id) openVideo(id);
    else doSearch(raw + (/deutsch|german|almanca/i.test(raw) ? '' : ' deutsch'));
  };
  $('#btn-yt-go').addEventListener('click', go);
  $('#yt-input').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });

  const chips = $('#channel-chips');
  CHANNELS.forEach((ch, i) => {
    const b = el('button', { class: 'chip', title: ch.note }, ch.name);
    b.addEventListener('click', () => showChannel(ch, b));
    chips.append(b);
    if (i === 0) setTimeout(() => b.click(), 400);
  });

  // transkriptte metin seçince "seçimi açıkla"
  const selBtn = $('#sel-btn');
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    const txt = sel ? String(sel).trim() : '';
    const anchor = sel && sel.anchorNode && sel.anchorNode.parentElement;
    const inside = anchor && (anchor.closest('#transcript') || anchor.closest('#book-content'));
    if (txt.split(/\s+/).length >= 2 && txt.length < 200 && inside) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      selBtn.hidden = false;
      selBtn.style.left = Math.min(Math.max(8, r.left), window.innerWidth - 150) + 'px';
      selBtn.style.top = Math.max(60, r.top - 46) + 'px';
      selBtn.onclick = () => { selBtn.hidden = true; openPhrase(txt); sel.removeAllRanges(); };
    } else selBtn.hidden = true;
  });

  // son izlenen video
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
    if (last?.id) {
      $('#player-empty').replaceChildren(
        el('p', {}, 'Kaldığın yerden devam et:'),
        el('button', { class: 'btn primary', onclick: () => openVideo(last.id, last.title) }, '▶︎ ' + (last.title || last.id)),
      );
    }
  } catch { /* yoksay */ }
}

export const currentTranscriptText = () => cues.map(c => c.text).join(' ');
export { showHardWords };
