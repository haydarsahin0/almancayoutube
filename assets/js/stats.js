// İstatistik: okuma süresi takibi + istatistik sayfası
import { $, el } from './util.js';
import { getStats, dayStat, bumpStat, todayKey, allVocab, listBooks } from './store.js';
import { distribution, dueCount, nextDueAt, dueText } from './srs.js';

const BAR_HUE = '#dfb52f';          // tek seri — sıralı tek renk (koyu yüzeyde 3:1+)
const DAY = 86400000;

/* ----------------------------- okuma süresi ------------------------------ */
/* Süre, tik aralığına değil gerçek geçen zamana göre işlenir; böylece tarayıcı
   zamanlayıcıyı yavaşlatsa da (arka plan, pil tasarrufu) sayaç şişmez.        */
const TICK = 10000;         // her 10 sn'de bir kontrol
const MAX_CREDIT = 15000;   // bir tikte en fazla 15 sn yazılır
const IDLE_LIMIT = 90000;   // 1,5 dk hiç dokunulmadıysa okuma sayılmaz

let lastInput = Date.now();
let lastTick = Date.now();
let reading = false;
export const setReading = (on) => { reading = on; lastTick = Date.now(); };

const isReadingNow = () =>
  reading &&
  document.visibilityState === 'visible' &&
  !!$('#view-book')?.classList.contains('active') &&
  $('#study')?.hidden !== false &&
  Date.now() - lastInput <= IDLE_LIMIT;

export function initTracking() {
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev =>
    document.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true }));
  // sekmeye geri dönünce aradaki boşluk okumaya yazılmasın
  document.addEventListener('visibilitychange', () => { lastTick = Date.now(); });
  window.addEventListener('focus', () => { lastTick = Date.now(); });

  setInterval(() => {
    const now = Date.now();
    const delta = Math.min(now - lastTick, MAX_CREDIT);
    lastTick = now;
    if (!isReadingNow() || delta < 1000) return;
    bumpStat('secs', Math.round(delta / 1000));
  }, TICK);
}

/* -------------------------------- yardımcı -------------------------------- */
const fmtDur = (secs) => {
  const m = Math.round((secs || 0) / 60);
  if (m < 60) return `${m} dk`;
  return `${Math.floor(m / 60)} sa ${m % 60} dk`;
};
const dayLabel = (d) => `${d.getDate()} ${['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'][d.getMonth()]}`;

function lastDays(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY);
    out.push({ date: d, key: todayKey(d), s: dayStat(todayKey(d)) });
  }
  return out;
}

function streak() {
  const active = (s) => (s.pages || 0) > 0 || (s.reviews || 0) > 0 || (s.lookups || 0) > 0;
  let cur = 0, best = 0, run = 0;
  const days = Object.keys(getStats().days).sort();
  if (!days.length) return { cur: 0, best: 0 };
  const first = new Date(days[0] + 'T12:00:00');
  const now = new Date();
  for (let t = first.getTime(); t <= now.getTime() + 1000; t += DAY) {
    run = active(dayStat(todayKey(new Date(t)))) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  // bugün ya da dün biten seri güncel sayılır
  cur = run;
  if (!active(dayStat(todayKey()))) {
    const y = dayStat(todayKey(new Date(Date.now() - DAY)));
    cur = active(y) ? run : 0;
  }
  return { cur, best };
}

/* --------------------------------- kutular -------------------------------- */
const tile = (icon, value, label) => el('div', { class: 'kpi' },
  el('div', { class: 'kpi-i' }, icon),
  el('div', {}, el('div', { class: 'kpi-v' }, value), el('div', { class: 'kpi-l' }, label)));

/* ------------------------------ çubuk grafik ------------------------------ */
const METRICS = {
  pages: { label: 'Sayfa', unit: 'sayfa', get: s => s.pages || 0 },
  secs: { label: 'Dakika', unit: 'dk', get: s => Math.round((s.secs || 0) / 60) },
  words: { label: 'Kelime', unit: 'kelime', get: s => s.lookups || 0 },
};
let metric = 'pages';

function barChart() {
  const m = METRICS[metric];
  const days = lastDays(14);
  const vals = days.map(d => m.get(d.s));
  const max = Math.max(1, ...vals);
  const maxIdx = vals.lastIndexOf(max);

  const cols = days.map((d, i) => {
    const v = vals[i];
    const isToday = i === days.length - 1;
    const bar = el('span', {
      class: 'bar' + (v ? '' : ' zero'),
      style: `height:${v ? Math.max(6, (v / max) * 100) : 2}%;background:${v ? BAR_HUE : 'var(--line)'}`,
    });
    const col = el('button', {
      class: 'bar-col' + (isToday ? ' today' : ''),
      title: `${dayLabel(d.date)} · ${v} ${m.unit}`,
      'aria-label': `${dayLabel(d.date)}: ${v} ${m.unit}`,
      onclick: (e) => {
        const t = $('#bar-tip');
        t.textContent = `${dayLabel(d.date)} · ${v} ${m.unit}`;
        t.hidden = false;
        clearTimeout(barChart._t);
        barChart._t = setTimeout(() => { t.hidden = true; }, 2200);
        e.currentTarget.blur();
      },
    },
      // en yüksek gün ve bugün doğrudan etiketlenir, diğerleri dokununca
      (i === maxIdx && v) || (isToday && v) ? el('span', { class: 'bar-val' }, String(v)) : null,
      bar);
    return col;
  });

  return el('div', { class: 'chart' },
    el('div', { class: 'chart-head' },
      el('div', { class: 'chart-title' }, `Son 14 gün · ${m.label.toLowerCase()}`),
      el('div', { class: 'seg' }, ...Object.entries(METRICS).map(([k, v]) =>
        el('button', {
          class: 'seg-b' + (k === metric ? ' on' : ''),
          onclick: () => { metric = k; renderStats(); },
        }, v.label)))),
    el('div', { class: 'bars' }, ...cols),
    el('div', { class: 'bar-axis' },
      el('span', {}, dayLabel(days[0].date)),
      el('span', { id: 'bar-tip', class: 'bar-tip', hidden: true }),
      el('span', {}, 'bugün')),
  );
}

/* --------------------------- ustalık dağılımı ----------------------------- */
function masteryChart() {
  const dist = distribution();
  const total = dist.reduce((a, d) => a + d.count, 0);
  const seg = el('div', { class: 'stack' },
    ...(total
      ? dist.filter(d => d.count).map(d =>
          el('span', { class: 'stack-s', style: `flex:${d.count};background:${d.color}`, title: `${d.label}: ${d.count}` }))
      : [el('span', { class: 'stack-s', style: 'flex:1;background:var(--line)' })]));
  return el('div', { class: 'chart' },
    el('div', { class: 'chart-title' }, `Kelime ustalığı · ${total} kelime`),
    seg,
    el('div', { class: 'legend' }, ...dist.map(d =>
      el('div', { class: 'lg' },
        el('span', { class: 'sw', style: `background:${d.color}` }),
        el('span', { class: 'lg-t' }, d.label),
        el('span', { class: 'lg-v' }, String(d.count))))),
    el('p', { class: 'hint' }, 'Bir kelimeyi tekrar ettikçe bir üst kutuya çıkar; bilemezsen başa döner.'),
  );
}

/* ------------------------------- sayfa render ----------------------------- */
export async function renderStats() {
  const box = $('#stats-body');
  if (!box) return;
  const t = dayStat(todayKey());
  const st = streak();
  const due = dueCount();
  const vocab = allVocab();
  const totals = Object.values(getStats().days).reduce((a, d) => ({
    pages: a.pages + (d.pages || 0), secs: a.secs + (d.secs || 0),
    lookups: a.lookups + (d.lookups || 0), reviews: a.reviews + (d.reviews || 0),
  }), { pages: 0, secs: 0, lookups: 0, reviews: 0 });

  const next = nextDueAt();
  const dueCard = el('div', { class: 'due-card' + (due ? ' on' : '') },
    el('div', {},
      el('div', { class: 'due-n' }, due ? `${due} kelime` : 'Tekrar yok'),
      el('div', { class: 'due-t' }, due
        ? 'bugün tekrar etmen gerekiyor'
        : (next ? `sıradaki tekrar ${dueText({ due: next })}` : 'önce kitapta kelime kaydet'))),
    due ? el('button', { class: 'btn primary', onclick: () => document.dispatchEvent(new CustomEvent('start-study')) }, '🎴 Başla') : null,
  );

  box.replaceChildren(
    el('div', { class: 'kpi-row' },
      tile('🔥', String(st.cur), st.cur === 1 ? 'günlük seri' : 'günlük seri'),
      tile('📖', String(t.pages || 0), 'bugün sayfa'),
      tile('⏱', fmtDur(t.secs), 'bugün okuma'),
      tile('👆', String(t.lookups || 0), 'bugün kelime')),
    dueCard,
    barChart(),
    masteryChart(),
    el('div', { class: 'chart' },
      el('div', { class: 'chart-title' }, 'Toplam'),
      el('div', { class: 'rows' },
        row('📚', 'Kitaplığındaki kitap', String((await listBooks().catch(() => [])).length)),
        row('📄', 'Okunan sayfa', String(totals.pages)),
        row('⏱', 'Okuma süresi', fmtDur(totals.secs)),
        row('🔎', 'Sorulan kelime', String(totals.lookups)),
        row('⭐', 'Kelime defterin', String(vocab.length)),
        row('🎴', 'Yapılan tekrar', String(totals.reviews)),
        row('🏆', 'En uzun seri', `${st.best} gün`))),
  );
}

const row = (icon, label, value) => el('div', { class: 'srow' },
  el('span', { class: 'si' }, icon), el('span', { class: 'sl' }, label), el('span', { class: 'sv' }, value));

export function initStats() {
  initTracking();
  document.addEventListener('stats-changed', () => {
    if ($('#view-stats')?.classList.contains('active')) renderStats();
  });
  document.addEventListener('vocab-changed', () => {
    if ($('#view-stats')?.classList.contains('active')) renderStats();
  });
}
