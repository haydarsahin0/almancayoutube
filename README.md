# 🇩🇪 Almanca Öğren — Video & Kitap

Telefon ve tablette çalışan, kurulum gerektirmeyen bir Almanca öğrenme uygulaması.
İki bölümü var:

1. **🎬 Video** — Almanca YouTube videolarını, senkron transkriptiyle birlikte izlersin.
   Transkriptteki **herhangi bir kelimeye dokunduğunda** yapay zeka o kelimeyi öğretir.
2. **📚 Kitap** — PDF, EPUB veya TXT dosyası yüklersin; okurken aynı şekilde kelimeye dokunup öğrenirsin.

Bir kelimeye dokunduğunda gösterilenler:

- Kelimenin **A2 seviyesinde basit Almanca açıklaması** (`Das Wetter sagt, ob es warm oder kalt ist.`)
- **Türkçe karşılıkları** ve o cümledeki anlamı
- Almanların gerçekten kullandığı **eş anlamlı kelimeler** (Türkçeleri ve aralarındaki farkla)
- Zıt anlamlılar
- **Örnek cümleler** (Almanca + Türkçe çevirisi)
- İsimlerde artikel/çoğul, fiillerde Präsens / Präteritum / Perfekt bilgisi
- Sesli okuma 🔊 ve kelime defterine kaydetme ⭐

---

## Kurulum (tek seferlik, telefondan yapılabilir)

### 1. Siteyi yayına al (GitHub Pages)

1. GitHub'da bu depoyu aç → **Settings** → sol menüden **Pages**
2. **Build and deployment → Source** kısmında **Deploy from a branch** seç
3. **Branch**: bu dalı (`claude/german-learning-video-pdf-jog23v` ya da `main`) ve klasör olarak **`/ (root)`** seç → **Save**
4. 1-2 dakika sonra sayfanın üstünde adresin çıkar:

```
https://haydarsahin0.github.io/almancayoutube/
```

Bu adresi telefonunda tarayıcıda aç. **Paylaş → Ana ekrana ekle** dersen uygulama gibi çalışır (PWA).

### 2. OpenAI API anahtarını gir

1. https://platform.openai.com/api-keys adresinden bir anahtar oluştur (`sk-...`)
2. Uygulamada sağ üstteki **⚙️** → **OpenAI API anahtarı** alanına yapıştır → **Kaydet**

> Anahtar **sadece kendi cihazının tarayıcısında** (localStorage) saklanır. Depoya, sunucuya ya da başka
> bir yere gönderilmez; istekler doğrudan cihazından `api.openai.com` adresine gider.
> Anahtarı asla bu depoya veya bir mesaja yazma; sadece uygulamanın Ayarlar ekranına gir.

Varsayılan model `gpt-4o-mini` (ucuz ve hızlı). Ayarlar'dan değiştirebilirsin.
Seviyeni de (A1/A2/B1/B2) oradan seçersin; açıklamalar ona göre basitleşir.

---

## Kullanım

### Video

- **Videolar** sekmesinde hazır Almanca öğrenme kanalları var (Easy German, DW Learn German, …).
  Kanala dokun → son videoları listelenir → birine dokun.
- Arama kutusuna **YouTube bağlantısı** yapıştırırsan o video açılır; normal bir şey yazarsan YouTube'da aranır.
- Video oynarken transkript otomatik kayar, o an konuşulan satır vurgulanır.
- Soldaki **zaman damgasına** dokunursan video oraya atlar.
- **Kelimeye dokun** → açıklama paneli açılır.
- Birden fazla kelimeyi **seçersen** (parmağını basılı tutup sürükle) → “Seçimi açıkla” çıkar, deyimleri/kalıpları açıklar.
- **✨ Zor kelimeler** → yapay zeka o videodaki senin seviyenin üstündeki kelimeleri listeler.
- Videoda altyazı yoksa: **📋 Transkripti elle ekle** ile YouTube uygulamasındaki transkripti
  yapıştırabilir ya da `.srt` / `.vtt` dosyası yükleyebilirsin.

### Kitap

- **📚 Dosya seç** → PDF / EPUB / TXT yükle. Dosya cihazında saklanır (IndexedDB), kaldığın yer hatırlanır.
- **A− / A+** ile yazı boyutunu değiştir, üstteki listeden bölüm/sayfa değiştir.
- Metindeki kelimeye dokun → aynı açıklama paneli.
- **🗂️ Kitaplığım** → daha önce yüklediğin dosyalar.

### Kelimelerim

- Panelde **⭐** dediğin kelimeler burada birikir.
- **🎴 Kart çalışması** ile tekrar edersin (bilmediklerin öne gelir).
- **⬇️ Dışa aktar / ⬆️ İçe aktar** ile kelime listeni yedekleyebilirsin.
- Kaydettiğin kelimeler video ve kitapta sarı olarak işaretlenir.

---

## Teknik notlar

- Tamamen istemci tarafında çalışır; sunucu, veritabanı, derleme adımı yok. Statik dosyalar yeter.
- YouTube altyazıları tarayıcıdan doğrudan indirilemediği için (CORS), açık CORS aracıları
  sırayla denenir (`api.allorigins.win`, `corsproxy.io`, `api.codetabs.com`, …). Biri çalışmazsa
  diğerine geçilir; hiçbiri çalışmazsa transkripti elle ekleyebilirsin.
- PDF için `pdf.js`, EPUB için `JSZip` CDN'den yüklenir.
- Yapay zeka yanıtları cihazda önbelleğe alınır — aynı kelimeye tekrar dokunmak ücretsizdir.

### Dosya yapısı

```
index.html              arayüz iskeleti
manifest.webmanifest    ana ekrana eklenebilmesi için
sw.js                   çevrimdışı önbellek
assets/css/app.css      tüm stiller
assets/js/main.js       giriş, sekmeler, ayarlar
assets/js/ai.js         OpenAI istekleri ve istemler
assets/js/word.js       kelime paneli
assets/js/video.js      oynatıcı + transkript
assets/js/youtube.js    altyazı indirme, arama, kanallar
assets/js/book.js       PDF / EPUB / TXT okuyucu
assets/js/vocab.js      kelime defteri ve kartlar
assets/js/store.js      ayarlar, kayıtlar, kitaplık
assets/js/util.js       ortak yardımcılar
```
