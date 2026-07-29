// Uygulama girişi: sekmeler, ayarlar, ilk kurulum
import { $, $$, el, toast } from './util.js';
import { getSettings, setSettings } from './store.js';
import { listModels } from './ai.js';
import { initModal, showModal, closeModal } from './ui.js';
import { initWordSheet } from './word.js';
import { initVideo, pauseVideo } from './video.js';
import { initBook } from './book.js';
import { initVocab } from './vocab.js';

/* --------------------------------- sekmeler -------------------------------- */
function goto(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.goto === name));
  if (name !== 'video') pauseVideo();
  window.scrollTo({ top: 0 });
  localStorage.setItem('dl.tab', name);
}

/* --------------------------------- ayarlar -------------------------------- */
function settingsDialog() {
  const s = getSettings();
  const key = el('input', { type: 'password', value: s.apiKey, placeholder: 'sk-…', autocomplete: 'off', spellcheck: 'false' });
  const model = el('input', { type: 'text', value: s.model, placeholder: 'gpt-4o-mini' });
  const level = el('select', { class: 'select', style: 'width:100%' },
    ...['A1', 'A2', 'B1', 'B2'].map(l => el('option', { value: l, selected: s.level === l || null }, l + ' seviyesi')));
  const autoSpeak = el('input', { type: 'checkbox', checked: s.autoSpeak || null });
  const baseUrl = el('input', { type: 'text', value: s.baseUrl, placeholder: 'https://api.openai.com/v1' });

  // hesaptaki modelleri canlı listele
  const modelBox = el('div', { class: 'chips', style: 'width:100%;padding:0' });
  const pickModel = (id) => {
    model.value = id;
    modelBox.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.textContent === id));
  };
  const showModels = (ids) => {
    modelBox.replaceChildren(...ids.slice(0, 40).map(id =>
      el('button', { class: 'chip' + (id === model.value ? ' on' : ''), onclick: () => pickModel(id) }, id)));
    if (!ids.length) modelBox.append(el('p', { class: 'hint' }, 'Sohbet modeli bulunamadı.'));
  };
  const fetchBtn = el('button', { class: 'chip' }, '🔄 Modellerimi getir');
  fetchBtn.addEventListener('click', async () => {
    setSettings({ apiKey: key.value.trim(), baseUrl: baseUrl.value.trim() || 'https://api.openai.com/v1' });
    fetchBtn.disabled = true; fetchBtn.textContent = 'Getiriliyor…';
    try {
      const ids = await listModels();
      localStorage.setItem('dl.models', JSON.stringify(ids));
      showModels(ids);
      fetchBtn.textContent = `🔄 Yenile (${ids.length})`;
    } catch (e) {
      modelBox.replaceChildren(el('p', { class: 'hint', style: 'color:#ff9b9b' }, e.message));
      fetchBtn.textContent = '🔄 Tekrar dene';
    } finally { fetchBtn.disabled = false; }
  });
  try {
    const cached = JSON.parse(localStorage.getItem('dl.models') || '[]');
    if (cached.length) showModels(cached);
  } catch { /* yoksay */ }

  const body = el('div', {},
    el('div', { class: 'form-group' },
      el('label', {}, 'OpenAI API anahtarı'),
      key,
      el('p', { class: 'hint' }, 'Anahtar yalnızca bu cihazın tarayıcısında saklanır, hiçbir sunucuya gönderilmez. ' +
        'İsteklerin doğrudan cihazından api.openai.com adresine gider.'),
      el('p', { class: 'hint' }, 'Anahtarı platform.openai.com → API keys sayfasından alabilirsin.')),
    el('div', { class: 'form-group' },
      el('label', {}, 'Model'),
      model,
      el('div', { class: 'chips', style: 'padding-top:8px' }, fetchBtn, modelBox),
      el('p', { class: 'hint' }, 'Düğmeye basınca hesabının erişebildiği modeller en yeniden eskiye doğru listelenir; ' +
        'hangi sürümler açıldıysa (gpt-5.x gibi) burada görünür. İstersen kutuya elle de yazabilirsin.')),
    el('div', { class: 'form-group' },
      el('label', {}, 'Almanca seviyen'), level,
      el('p', { class: 'hint' }, 'Açıklamalar bu seviyeye göre basitleştirilir.')),
    el('div', { class: 'form-group' },
      el('label', { style: 'display:flex;align-items:center;gap:10px' }, autoSpeak, 'Kelimeye dokununca otomatik seslendir')),
    el('details', { class: 'form-group' },
      el('summary', { style: 'color:var(--tx-dim);font-size:13px' }, 'Gelişmiş'),
      el('div', { style: 'margin-top:10px' },
        el('label', {}, 'API adresi (uyumlu başka servis kullanacaksan)'), baseUrl,
        el('button', {
          class: 'chip', style: 'margin-top:12px',
          onclick: () => { localStorage.removeItem('dl.cache'); localStorage.removeItem('dl.proxy.pref'); toast('Önbellek temizlendi'); },
        }, '🧹 Önbelleği temizle'))),
    el('div', { style: 'display:flex;gap:8px;margin-top:6px' },
      el('button', {
        class: 'btn primary grow', onclick: () => {
          setSettings({
            apiKey: key.value.trim(), model: model.value.trim() || 'gpt-4o-mini',
            level: level.value, autoSpeak: autoSpeak.checked,
            baseUrl: baseUrl.value.trim() || 'https://api.openai.com/v1',
          });
          closeModal();
          toast('Ayarlar kaydedildi ✓');
        },
      }, 'Kaydet'),
      el('button', { class: 'btn', onclick: closeModal }, 'Kapat')),
  );
  showModal('Ayarlar', body);
}

/* ---------------------------------- açılış -------------------------------- */
function welcome() {
  showModal('Hoş geldin! 🇩🇪', el('div', {},
    el('p', {}, 'Bu uygulama iki şekilde Almanca öğretir:'),
    el('p', {}, '🎬 ', el('b', {}, 'Video'), ': Almanca YouTube videolarını altyazı/transkriptiyle birlikte izlersin. ' +
      'Transkriptteki herhangi bir kelimeye dokunduğunda anlamını, eş anlamlılarını ve örnek cümlelerini gösteririm.'),
    el('p', {}, '📚 ', el('b', {}, 'Kitap'), ': PDF, EPUB ya da TXT dosyası yüklersin; aynı şekilde kelimeye dokunup öğrenirsin.'),
    el('p', { class: 'hint' }, 'Başlamak için OpenAI API anahtarını girmen gerekiyor. Anahtar sadece bu cihazda saklanır.'),
    el('div', { style: 'display:flex;gap:8px;margin-top:14px' },
      el('button', { class: 'btn primary grow', onclick: () => { closeModal(); settingsDialog(); } }, 'API anahtarını gir'),
      el('button', { class: 'btn', onclick: closeModal }, 'Sonra')),
  ));
  localStorage.setItem('dl.seen', '1');
}

function boot() {
  initModal();
  initWordSheet();
  initVideo();
  initBook();
  initVocab();

  $$('.tab').forEach(t => t.addEventListener('click', () => goto(t.dataset.goto)));
  $('#btn-settings').addEventListener('click', settingsDialog);
  goto(localStorage.getItem('dl.tab') || 'video');

  if (!localStorage.getItem('dl.seen')) setTimeout(welcome, 300);
  else if (!getSettings().apiKey) setTimeout(() => toast('⚙️ Ayarlar\'dan OpenAI anahtarını girmeyi unutma'), 900);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
