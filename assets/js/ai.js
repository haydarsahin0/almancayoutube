// OpenAI ile kelime öğretimi
import { getSettings, cacheGet, cacheSet } from './store.js';

export class AIError extends Error {
  constructor(msg, kind = 'other') { super(msg); this.kind = kind; }
}

/* Her modelin kabul ettiği parametreler farklı (yeni nesil modeller max_tokens
   yerine max_completion_tokens istiyor, sabit temperature kullanıyor vb.).
   Öğrendiklerimizi model başına hatırlayıp bir daha aynı hatayı yapmıyoruz. */
const compatKey = (m) => 'dl.compat.' + m;
function getCompat(model) {
  try { return JSON.parse(localStorage.getItem(compatKey(model)) || '{}'); } catch { return {}; }
}
function setCompat(model, patch) {
  const next = { ...getCompat(model), ...patch };
  localStorage.setItem(compatKey(model), JSON.stringify(next));
  return next;
}

function apiBase() {
  return (getSettings().baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

async function post(path, payload) {
  const s = getSettings();
  let r;
  try {
    r = await fetch(apiBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.apiKey },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new AIError('İnternete ulaşılamadı: ' + e.message, 'net');
  }
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* düz metin hata olabilir */ }
  if (!r.ok) {
    const msg = data?.error?.message || text.slice(0, 300);
    const err = new AIError(msg, r.status === 401 ? 'auth' : r.status === 429 ? 'limit'
      : r.status === 404 ? 'model' : 'http');
    err.status = r.status; err.raw = msg; err.code = data?.error?.code || '';
    err.param = data?.error?.param || '';
    throw err;
  }
  return data;
}

async function chat(messages, { json = true, maxTokens = 1100, temperature = 0.2 } = {}) {
  const s = getSettings();
  if (!s.apiKey) throw new AIError('Önce Ayarlar\'dan OpenAI API anahtarını gir.', 'nokey');
  const model = s.model || 'gpt-4o-mini';
  let c = getCompat(model);
  let budget = Math.max(maxTokens, c.minTokens || 0);

  const build = () => {
    const p = { model, messages };
    p[c.tokenParam || 'max_tokens'] = budget;
    if (json && !c.noJson) p.response_format = { type: 'json_object' };
    if (temperature !== null && !c.noTemp) p.temperature = temperature;
    return p;
  };

  let data = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      data = await post('/chat/completions', build());
    } catch (e) {
      if (!(e instanceof AIError) || e.status !== 400) throw e;
      const m = (e.raw || '') + ' ' + (e.param || '');
      // hangi parametreyi beğenmediğini anlayıp onu bırakıp tekrar deniyoruz
      if (/max_completion_tokens/i.test(m) && (c.tokenParam || 'max_tokens') === 'max_tokens') {
        c = setCompat(model, { tokenParam: 'max_completion_tokens' }); continue;
      }
      if (/max_tokens/i.test(m) && c.tokenParam === 'max_completion_tokens') {
        c = setCompat(model, { tokenParam: 'max_tokens' }); continue;
      }
      if (/temperature/i.test(m) && !c.noTemp) { c = setCompat(model, { noTemp: true }); continue; }
      if (/response_format|json_object|json_schema/i.test(m) && !c.noJson) {
        c = setCompat(model, { noJson: true }); continue;
      }
      throw e;
    }

    const choice = data?.choices?.[0];
    const content = choice?.message?.content || '';
    if (content.trim()) return content;

    // Düşünen modellerde bütçe akıl yürütmeye gidip yanıt boş kalabilir → bütçeyi büyüt
    if (choice?.finish_reason === 'length' && budget < 8000) {
      budget = Math.min(8000, budget * 3);
      setCompat(model, { minTokens: budget });
      continue;
    }
    throw new AIError('Model boş yanıt verdi. Ayarlar\'dan başka bir model dene.', 'empty');
  }
  throw new AIError('Model bu isteği kabul etmedi. Ayarlar\'dan başka bir model dene.', 'http');
}

/** Hesabın erişebildiği sohbet modellerini yeniden eskiye doğru listeler */
export async function listModels() {
  const s = getSettings();
  if (!s.apiKey) throw new AIError('Önce API anahtarını gir.', 'nokey');
  let r;
  try {
    r = await fetch(apiBase() + '/models', { headers: { Authorization: 'Bearer ' + s.apiKey } });
  } catch (e) { throw new AIError('İnternete ulaşılamadı: ' + e.message, 'net'); }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new AIError(data?.error?.message || ('HTTP ' + r.status), r.status === 401 ? 'auth' : 'http');
  const skip = /embed|tts|whisper|dall-e|audio|realtime|image|moderation|transcribe|speech|search|instruct|davinci|babbage|computer-use/i;
  return (data?.data || [])
    .filter(m => /^(gpt|o\d|chatgpt)/i.test(m.id) && !skip.test(m.id))
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .map(m => m.id);
}

function parseJSON(txt) {
  try { return JSON.parse(txt); } catch { /* devam */ }
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* devam */ } }
  throw new AIError('Yanıt çözümlenemedi.', 'parse');
}

const SYSTEM = (level) => `Sen Türkçe konuşan öğrencilere Almanca öğreten deneyimli bir öğretmensin.
Öğrencinin seviyesi ${level}. Açıklamalarında ${level} seviyesini aşan Almanca kullanma; Almanca cümleler kısa ve basit olsun.
Türkçe açıklamalar doğal, sade ve net olsun. Uydurma bilgi verme; emin değilsen alanı boş bırak.
Yanıtın SADECE geçerli JSON olsun, başka hiçbir metin ekleme.`;

const WORD_SCHEMA = `{
  "wort": "tıklanan kelimenin cümledeki hali",
  "lemma": "sözlük hali (isimlerde tekil yalın, fiillerde mastar)",
  "artikel": "isimse der/die/das, değilse boş string",
  "plural": "isimse çoğul hali, yoksa boş string",
  "wortart": "Nomen | Verb | Adjektiv | Adverb | Präposition | Pronomen | Konjunktion | Partikel | Zahlwort | Redewendung",
  "form_erklaerung": "Kelimenin cümledeki hali neden böyle (çekim/hal/zaman) — TÜRKÇE, tek kısa cümle",
  "erklaerung_de": "Kelimenin anlamının BASİT ALMANCA açıklaması (1-2 kısa cümle)",
  "anlam_tr": ["en yaygın Türkçe karşılıklar, 1-4 tane"],
  "baglam_tr": "Bu cümlede tam olarak ne anlama geldiği — TÜRKÇE, tek cümle",
  "synonyme": [{"wort":"Almanca eş anlamlı", "tr":"Türkçesi", "hinweis":"kullanım farkı — TÜRKÇE, kısa"}],
  "gegenteil": [{"wort":"Almanca zıt anlamlı", "tr":"Türkçesi"}],
  "beispiele": [{"de":"basit Almanca örnek cümle", "tr":"Türkçe çevirisi"}],
  "verb_info": {"praesens_er":"er/sie/es çekimi", "praeteritum":"", "perfekt":"haben/sein + partizip", "trennbar": true, "kasus":"aldığı hal/edat (varsa)"},
  "tipp": "aklında kalması için kısa ipucu — TÜRKÇE"
}`;

export async function lookupWord(word, context = '', { force = false } = {}) {
  const s = getSettings();
  const ctx = (context || '').slice(0, 400);
  const key = `w:${s.model}:${s.level}:${word}:${ctx}`;
  if (!force) {
    const c = cacheGet(key);
    if (c) return { ...c, _cached: true };
  }
  const user = `Kelime: "${word}"
${ctx ? `Geçtiği cümle: "${ctx}"` : 'Cümle bağlamı yok.'}

Bu kelimeyi öğrenciye öğret. Şu JSON şemasına birebir uy (alan adlarını değiştirme):
${WORD_SCHEMA}

Kurallar:
- "erklaerung_de" mutlaka ${s.level} seviyesinde basit Almanca olsun.
- "synonyme" alanına Almanların bu kelimenin yerine gerçekten kullandığı 2-4 kelime yaz.
- "beispiele" alanına 2-3 örnek cümle yaz; biri mümkünse verilen bağlama benzesin.
- Kelime fiil değilse "verb_info" null olsun.
- Kelime bir ayrılabilir fiilin parçası ya da deyim ise bunu "form_erklaerung" içinde belirt.`;

  const out = parseJSON(await chat([
    { role: 'system', content: SYSTEM(s.level) },
    { role: 'user', content: user },
  ]));
  out.wort = out.wort || word;
  cacheSet(key, out);
  return out;
}

export async function explainPhrase(phrase, context = '') {
  const s = getSettings();
  const key = `p:${s.model}:${s.level}:${phrase}:${(context || '').slice(0, 200)}`;
  const c = cacheGet(key);
  if (c) return { ...c, _cached: true };
  const out = parseJSON(await chat([
    { role: 'system', content: SYSTEM(s.level) },
    {
      role: 'user', content: `Almanca ifade: "${phrase}"
${context ? `Geçtiği metin: "${context.slice(0, 400)}"` : ''}
Şu JSON'u döndür:
{"ifade":"...", "tr":"Türkçe çevirisi", "erklaerung_de":"basit Almanca açıklama",
 "yapisi":"dilbilgisi yapısının Türkçe açıklaması (kısa)",
 "kelimeler":[{"wort":"içindeki önemli kelime","tr":"Türkçesi"}],
 "beispiele":[{"de":"...","tr":"..."}],
 "aehnlich":[{"wort":"benzer ifade","tr":"Türkçesi"}]}`,
    },
  ]));
  cacheSet(key, out);
  return out;
}

export async function translateSentence(sentence) {
  const s = getSettings();
  const key = `t:${s.model}:${sentence}`;
  const c = cacheGet(key);
  if (c) return c;
  const out = parseJSON(await chat([
    { role: 'system', content: SYSTEM(s.level) },
    { role: 'user', content: `Bu Almanca cümleyi Türkçeye çevir ve içindeki bir dilbilgisi noktasını kısaca açıkla.
Cümle: "${sentence.slice(0, 500)}"
JSON: {"tr":"çeviri", "not":"kısa dilbilgisi notu (Türkçe)"}` },
  ], { maxTokens: 400 }));
  cacheSet(key, out);
  return out;
}

export async function hardWords(text, { known = [] } = {}) {
  const s = getSettings();
  const body = text.slice(0, 6000);
  const key = `h:${s.model}:${s.level}:${body.length}:${body.slice(0, 200)}`;
  const c = cacheGet(key);
  if (c) return c;
  const out = parseJSON(await chat([
    { role: 'system', content: SYSTEM(s.level) },
    {
      role: 'user', content: `Aşağıdaki Almanca metinden, ${s.level} seviyesindeki bir öğrencinin muhtemelen BİLMEDİĞİ en önemli 12 kelime/ifadeyi seç.
${known.length ? `Şunları zaten biliyor, tekrar etme: ${known.slice(0, 60).join(', ')}` : ''}
JSON: {"kelimeler":[{"lemma":"sözlük hali (isimse artikelle: der Tisch)","tr":"Türkçe karşılığı","warum":"neden zor — çok kısa Türkçe"}]}

METİN:
"""${body}"""` },
  ], { maxTokens: 900 }));
  cacheSet(key, out);
  return out;
}
