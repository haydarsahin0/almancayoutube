// OpenAI ile kelime öğretimi
import { getSettings, cacheGet, cacheSet } from './store.js';

export class AIError extends Error {
  constructor(msg, kind = 'other') { super(msg); this.kind = kind; }
}

async function chat(messages, { json = true, maxTokens = 1100, temperature = 0.2 } = {}) {
  const s = getSettings();
  if (!s.apiKey) throw new AIError('Önce Ayarlar\'dan OpenAI API anahtarını gir.', 'nokey');

  const base = (s.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const body = {
    model: s.model || 'gpt-4o-mini',
    messages,
    max_tokens: maxTokens,
  };
  if (json) body.response_format = { type: 'json_object' };
  if (temperature !== null) body.temperature = temperature;

  const send = async (payload) => {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.apiKey },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* düz metin hata olabilir */ }
    if (!r.ok) {
      const msg = data?.error?.message || text.slice(0, 300);
      const err = new AIError(msg, r.status === 401 ? 'auth' : r.status === 429 ? 'limit' : 'http');
      err.status = r.status; err.raw = msg;
      throw err;
    }
    return data;
  };

  let data;
  try {
    data = await send(body);
  } catch (e) {
    // Bazı modeller temperature / response_format / max_tokens parametrelerini reddediyor → sadeleştirip tekrar dene
    if (e instanceof AIError && (e.status === 400 || e.status === 404)) {
      const retry = { model: body.model, messages };
      if (/max_tokens/i.test(e.raw || '')) retry.max_completion_tokens = maxTokens;
      try {
        data = await send(retry);
      } catch (e2) {
        if (e2 instanceof AIError) throw e2;
        throw new AIError('Bağlantı hatası: ' + e2.message, 'net');
      }
    } else if (e instanceof AIError) {
      throw e;
    } else {
      throw new AIError('İnternet/CORS hatası: ' + e.message, 'net');
    }
  }

  const content = data?.choices?.[0]?.message?.content || '';
  if (!content) throw new AIError('Model boş yanıt verdi.', 'empty');
  return content;
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
