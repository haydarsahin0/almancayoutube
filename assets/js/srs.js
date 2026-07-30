// Aralıklı tekrar (spaced repetition) — Leitner kutuları
import { allVocab, updateWord } from './store.js';
import { normWord } from './util.js';

const DAY = 86400000;
// kutu → bir sonraki tekrara kaç gün var
export const INTERVALS = [0, 1, 3, 7, 16, 35, 90];
const AGAIN_MS = 10 * 60 * 1000;   // bilinmeyen kelime aynı oturumda tekrar sorulur

export const LEVELS = [
  { key: 'new', label: 'Yeni', color: '#8a7434', test: b => (b || 0) === 0 },
  { key: 'learning', label: 'Öğreniliyor', color: '#b8952f', test: b => b >= 1 && b <= 2 },
  { key: 'known', label: 'Biliniyor', color: '#dfb52f', test: b => b >= 3 && b <= 4 },
  { key: 'mastered', label: 'Ustalaşıldı', color: '#ffcc33', test: b => b >= 5 },
];

export const levelOf = (v) => LEVELS.find(l => l.test(v.box || 0)) || LEVELS[0];

/** Eski kayıtlara tekrar alanlarını ekler */
export function normalize(v) {
  return {
    ...v,
    box: v.box || 0,
    reps: v.reps || 0,
    lapses: v.lapses || 0,
    due: typeof v.due === 'number' ? v.due : (v.added || Date.now()),
  };
}

export const isDue = (v, now = Date.now()) => normalize(v).due <= now;

/** Bugün çalışılacak kartlar: önce vakti gelenler (en eskisi önce), sonra hiç çalışılmamışlar */
export function dueQueue(limit = 20) {
  const now = Date.now();
  const all = allVocab().map(normalize);
  const due = all.filter(v => v.reps > 0 && v.due <= now).sort((a, b) => a.due - b.due);
  const fresh = all.filter(v => v.reps === 0).sort((a, b) => (a.added || 0) - (b.added || 0));
  return [...due, ...fresh].slice(0, limit);
}

export function dueCount(now = Date.now()) {
  return allVocab().map(normalize).filter(v => v.due <= now).length;
}

/** Bir sonraki tekrarın ne zaman olduğunu söyler (bugün hiç yoksa) */
export function nextDueAt() {
  const list = allVocab().map(normalize).map(v => v.due).sort((a, b) => a - b);
  return list.length ? list[0] : null;
}

/** Cevabı işler ve kelimeyi yeniden zamanlar. known=false → kutu sıfırlanır */
export function answer(v, known) {
  const cur = normalize(v);
  const box = known ? Math.min(INTERVALS.length - 1, cur.box + 1) : 0;
  const due = known ? Date.now() + INTERVALS[box] * DAY : Date.now() + AGAIN_MS;
  const patch = {
    box, due,
    reps: cur.reps + 1,
    lapses: cur.lapses + (known ? 0 : 1),
    seen: (cur.seen || 0) + 1,
    last: Date.now(),
  };
  updateWord(cur.lemma || cur.word, patch);
  return { ...cur, ...patch };
}

/** "3 gün sonra" gibi okunabilir aralık metni */
export function dueText(v) {
  const d = normalize(v).due - Date.now();
  if (d <= 0) return 'şimdi';
  const days = Math.round(d / DAY);
  if (days >= 1) return days === 1 ? 'yarın' : `${days} gün sonra`;
  const mins = Math.max(1, Math.round(d / 60000));
  return mins < 60 ? `${mins} dk sonra` : `${Math.round(mins / 60)} saat sonra`;
}

export function distribution() {
  const all = allVocab().map(normalize);
  return LEVELS.map(l => ({ ...l, count: all.filter(v => l.test(v.box)).length }));
}

export const vocabKeySet = () => new Set(allVocab().map(v => normWord(v.lemma || v.word)));
