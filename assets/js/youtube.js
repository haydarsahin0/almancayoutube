// YouTube: video arama, kanal listeleri ve altyazı (transkript) indirme
import { fetchVia, decodeEntities } from './util.js';

/* ----------------------------- video kimliği ----------------------------- */
export function parseVideoId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let m = s.match(/(?:youtube\.com\/(?:watch\?[^#]*\bv=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return m[1];
  try {
    const u = new URL(s);
    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;
  } catch { /* url değil */ }
  return null;
}

/* --------------------------- sayfa içi JSON okuma -------------------------- */
function extractJson(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  let start = html.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; } } }
  }
  return null;
}

const watchHtml = (videoId) => fetchVia(
  `https://www.youtube.com/watch?v=${videoId}&hl=de&bpctr=9999999999&has_verified=1`,
  { validate: t => t.includes('ytInitialPlayerResponse'), skipDirect: true },
);

/* ------------------------------- altyazılar ------------------------------- */
export async function listCaptionTracks(videoId) {
  const html = await watchHtml(videoId);
  const pr = extractJson(html, 'ytInitialPlayerResponse');
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  return tracks.map(t => ({
    lang: t.languageCode,
    name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode,
    asr: t.kind === 'asr',
    url: t.baseUrl,
  }));
}

export function pickTrack(tracks, prefer = 'de') {
  if (!tracks.length) return null;
  const de = tracks.filter(t => (t.lang || '').toLowerCase().startsWith(prefer));
  const pool = de.length ? de : (prefer === 'de' ? [] : tracks);
  return pool.find(t => !t.asr) || pool[0] || null;
}

function parseJson3(txt) {
  const j = JSON.parse(txt);
  const cues = [];
  for (const ev of j.events || []) {
    if (ev.aAppend) continue; // otomatik altyazıların yinelenen "kaydırma" satırları
    const text = (ev.segs || []).map(s => s.utf8).join('').replace(/\n/g, ' ').trim();
    if (!text) continue;
    cues.push({ start: (ev.tStartMs || 0) / 1000, dur: (ev.dDurationMs || 0) / 1000, text });
  }
  return cues;
}

function parseTimedTextXml(txt) {
  const doc = new DOMParser().parseFromString(txt, 'text/xml');
  const cues = [];
  for (const n of doc.querySelectorAll('text')) {
    const text = decodeEntities(n.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    cues.push({ start: parseFloat(n.getAttribute('start') || '0'), dur: parseFloat(n.getAttribute('dur') || '0'), text });
  }
  return cues;
}

export async function fetchCues(track) {
  const base = track.url;
  const tries = [
    { url: base.includes('fmt=') ? base : base + '&fmt=json3', parse: parseJson3 },
    { url: base, parse: parseTimedTextXml },
  ];
  let lastErr;
  for (const t of tries) {
    try {
      const txt = await fetchVia(t.url, { skipDirect: true });
      const cues = t.parse(txt);
      if (cues.length) return cues;
      lastErr = new Error('altyazı boş');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('altyazı okunamadı');
}

/** Videonun altyazısını getirir. prefer: 'de' | 'any' */
export async function getTranscript(videoId, prefer = 'de') {
  const tracks = await listCaptionTracks(videoId);
  if (!tracks.length) throw new Error('Bu videoda altyazı yok. Transkripti elle ekleyebilirsin.');
  const track = pickTrack(tracks, prefer === 'any' ? 'de' : prefer)
    || (prefer === 'any' ? tracks[0] : null);
  if (!track) {
    throw new Error(`Almanca altyazı bulunamadı (mevcut: ${tracks.map(t => t.lang).join(', ')}). "Herhangi bir dil" seçeneğini dene.`);
  }
  const cues = await fetchCues(track);
  return { track, cues, tracks };
}

/* ------------------------------ video bilgisi ----------------------------- */
export async function getVideoInfo(videoId) {
  try {
    const txt = await fetchVia(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    const j = JSON.parse(txt);
    return { title: j.title, author: j.author_name };
  } catch { return { title: '', author: '' }; }
}

/* --------------------------------- arama --------------------------------- */
function walk(obj, fn) {
  if (!obj || typeof obj !== 'object') return;
  fn(obj);
  for (const k of Object.keys(obj)) walk(obj[k], fn);
}

export async function searchVideos(query) {
  const html = await fetchVia(
    'https://www.youtube.com/results?search_query=' + encodeURIComponent(query) + '&sp=EgIQAQ%253D%253D&hl=de',
    { validate: t => t.includes('ytInitialData'), skipDirect: true },
  );
  const data = extractJson(html, 'var ytInitialData') || extractJson(html, 'ytInitialData');
  const out = [], seen = new Set();
  walk(data, (o) => {
    const r = o.videoRenderer;
    if (!r || !r.videoId || seen.has(r.videoId)) return;
    seen.add(r.videoId);
    out.push({
      id: r.videoId,
      title: r.title?.runs?.map(x => x.text).join('') || r.title?.simpleText || '',
      author: r.ownerText?.runs?.[0]?.text || r.longBylineText?.runs?.[0]?.text || '',
      length: r.lengthText?.simpleText || '',
      thumb: `https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`,
    });
  });
  return out.slice(0, 30);
}

/* -------------------------------- kanallar -------------------------------- */
export const CHANNELS = [
  { name: 'Easy German', handle: 'EasyGerman', note: 'sokak röportajları, altyazılı' },
  { name: 'DW Learn German', handle: 'dwlearngerman', note: 'A1–C1 dersleri, Nicos Weg' },
  { name: 'Deutsch mit Marija', handle: 'DeutschmitMarija', note: 'dilbilgisi anlatımı' },
  { name: 'Learn German with Anja', handle: 'LearnGermanwithAnja', note: 'eğlenceli dersler' },
  { name: 'Deutsch für Euch', handle: 'DeutschFuerEuch', note: 'temel konular' },
  { name: '24h Deutsch', handle: '24hDeutsch', note: 'kısa günlük konular' },
  { name: 'Get Germanized', handle: 'GetGermanized', note: 'günlük dil ve kültür' },
  { name: 'Deutsch mit Rieke', handle: 'DeutschmitRieke', note: 'yavaş ve net konuşma' },
  { name: 'Hallo Deutschschule', handle: 'HalloDeutschschule', note: 'sınıf dersleri' },
  { name: 'Your German Teacher', handle: 'YourGermanTeacher', note: 'kelime ve pratik' },
];

const chIdKey = (h) => 'dl.ch.' + h;

export async function resolveChannelId(handle, name) {
  const cached = localStorage.getItem(chIdKey(handle));
  if (cached) return cached;
  const grab = (html) => {
    const m = html.match(/"(?:channelId|externalId)":"(UC[\w-]{20,})"/) ||
              html.match(/channel\/(UC[\w-]{20,})/);
    return m ? m[1] : null;
  };
  try {
    const html = await fetchVia(`https://www.youtube.com/@${handle}/videos?hl=de`, { skipDirect: true });
    const id = grab(html);
    if (id) { localStorage.setItem(chIdKey(handle), id); return id; }
  } catch { /* aşağıda aramayla dene */ }
  // handle tutmadıysa kanal adıyla ara
  const html = await fetchVia('https://www.youtube.com/results?search_query=' + encodeURIComponent(name || handle) + '&sp=EgIQAg%253D%253D', { skipDirect: true });
  const id = grab(html);
  if (!id) throw new Error('Kanal bulunamadı: ' + (name || handle));
  localStorage.setItem(chIdKey(handle), id);
  return id;
}

export async function channelVideos(channel) {
  const id = await resolveChannelId(channel.handle, channel.name);
  const xml = await fetchVia('https://www.youtube.com/feeds/videos.xml?channel_id=' + id, {
    validate: t => t.includes('<entry') || t.includes('yt:videoId'), skipDirect: true,
  });
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out = [];
  for (const e of doc.getElementsByTagName('entry')) {
    const vid = e.getElementsByTagName('yt:videoId')[0]?.textContent
      || e.getElementsByTagName('videoId')[0]?.textContent;
    if (!vid) continue;
    out.push({
      id: vid,
      title: e.getElementsByTagName('title')[0]?.textContent || '',
      author: channel.name,
      length: '',
      published: e.getElementsByTagName('published')[0]?.textContent || '',
      thumb: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
    });
  }
  return out;
}

/* ------------------------- elle eklenen transkriptler ---------------------- */
const tsRe = /(?:^|\s)(?:\[)?(\d{1,2}:\d{2}(?::\d{2})?)(?:\])?\s*/;

export function parseManualTranscript(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  if (/-->/.test(text)) return parseSrtVtt(text);
  const cues = [];
  const toSec = (s) => s.split(':').reverse().reduce((a, p, i) => a + parseFloat(p) * Math.pow(60, i), 0);
  // "0:12 metin" biçimi (YouTube uygulamasından kopyalanan transkript)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let pending = null;
  for (const line of lines) {
    const m = line.match(/^(?:\[)?(\d{1,2}:\d{2}(?::\d{2})?)(?:\])?\s*(.*)$/);
    if (m) {
      if (pending) cues.push(pending);
      pending = { start: toSec(m[1]), dur: 0, text: m[2] || '' };
    } else if (pending) {
      pending.text = (pending.text + ' ' + line).trim();
    } else {
      cues.push({ start: 0, dur: 0, text: line });
    }
  }
  if (pending) cues.push(pending);
  const clean = cues.filter(c => c.text);
  for (let i = 0; i < clean.length; i++) {
    clean[i].dur = clean[i].dur || Math.max(1, (clean[i + 1]?.start ?? clean[i].start + 4) - clean[i].start);
  }
  return clean;
}

export function parseSrtVtt(text) {
  const toSec = (t) => {
    const m = t.trim().replace(',', '.').match(/(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)/);
    if (!m) return 0;
    return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2], 10) * 60) + parseFloat(m[3]);
  };
  const blocks = String(text).replace(/\r/g, '').replace(/^WEBVTT[^\n]*\n/, '').split(/\n\s*\n/);
  const cues = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter(Boolean);
    const ti = lines.findIndex(l => l.includes('-->'));
    if (ti < 0) continue;
    const [a, z] = lines[ti].split('-->');
    const body = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!body) continue;
    const start = toSec(a), end = toSec(z);
    cues.push({ start, dur: Math.max(0.5, end - start), text: body });
  }
  return cues;
}
