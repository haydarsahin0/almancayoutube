# 📖 Almanca Okuyucu

Telefon ve tablette çalışan, kurulum gerektirmeyen bir Almanca okuma uygulaması.

PDF, EPUB veya TXT dosyası yüklersin; kitap **gerçek bir kitap gibi sayfa sayfa** açılır.
Metindeki **herhangi bir kelimeye dokunduğunda** yapay zeka o kelimeyi sana öğretir:

- Kelimenin **basit Almanca açıklaması** (seviyene göre — `Das Wetter sagt, ob es warm oder kalt ist.`)
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
3. **Branch**: bu dalı ve klasör olarak **`/ (root)`** seç → **Save**
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

Model seçimi: Ayarlar'da **🔄 Modellerimi getir** düğmesine bas — hesabının erişebildiği
sohbet modelleri **en yeniden eskiye** doğru listelenir, dokunup seçersin. OpenAI yeni bir sürüm
çıkardığında (gpt-5.x gibi) listede kendiliğinden görünür; istersen model adını elle de yazabilirsin.
Uygulama her modelin kabul ettiği parametreleri (ör. `max_completion_tokens`, sabit `temperature`)
ilk istekte kendisi öğrenip hatırlar, düşünen modellerde yanıt bütçesini otomatik büyütür.

Seviyeni de (A1/A2/B1/B2) Ayarlar'dan seçersin; açıklamalar ona göre basitleşir.

---

## Kullanım

### Okuma

- Sağ üstteki **🗂️** → **Yeni dosya seç** ile PDF / EPUB / TXT yükle.
  Dosya cihazında saklanır (IndexedDB), kaldığın sayfa hatırlanır.
- **Sayfa çevirmek için**: parmağını sağa/sola kaydır, sayfanın boş bir yerine dokun
  ya da alttaki **‹ ›** düğmelerini kullan. (Bilgisayarda ok tuşları da çalışır.)
  Metin ekrana sığacak şekilde sayfalara bölünür — uzun uzun aşağı kaydırma yok.
- Alt çubuktaki **bölüm · sayfa** yazısına dokununca **içindekiler** açılır, istediğin bölüme atlarsın.
- **Aa** → tema (📜 Kağıt / ☀️ Açık / 🌙 Gece), yazı boyutu, yazı tipi (kitap/ekran),
  satır aralığı ve hizalama. Değiştirince sayfalar anında yeniden hesaplanır, seçimin hatırlanır.
- **✨** → yapay zeka o bölümdeki senin seviyenin üstündeki kelimeleri listeler.
- Metindeki **kelimeye dokun** → açıklama paneli açılır.
- Birden fazla kelimeyi **seçersen** (basılı tutup sürükle) → “Seçimi açıkla” çıkar,
  deyimleri ve kalıpları açıklar.

Metin gerçek bir kitap gibi dizilir: serif yazı tipi, iki yana yaslı satırlar, Almanca heceleme,
bölüm başında büyük harf (drop cap), ortalanmış bölüm başlıkları, üstte kitap adı ve sayfa numarası,
altta ilerleme çubuğu.

### Kelimelerim

- Panelde **⭐** dediğin kelimeler burada birikir.
- **🎴 Kart çalışması** ile tekrar edersin (bilmediklerin öne gelir).
- **⬇️ Dışa aktar / ⬆️ İçe aktar** ile kelime listeni yedekleyebilirsin.
- Kaydettiğin kelimeler kitapta işaretli görünür.

---

## Teknik notlar

- Tamamen istemci tarafında çalışır; sunucu, veritabanı, derleme adımı yok. Statik dosyalar yeter.
- Sayfalama CSS çoklu sütun (`column-width`) ile yapılır: bölüm ekran boyu sütunlara akıtılır,
  sayfa çevirmek sütunları yatay kaydırmaktır. Ekran döndüğünde/punto değişince yeniden ölçülür.
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
assets/js/book.js       PDF / EPUB / TXT okuyucu ve sayfalama
assets/js/word.js       kelime paneli
assets/js/vocab.js      kelime defteri ve kartlar
assets/js/store.js      ayarlar, kayıtlar, kitaplık
assets/js/util.js       ortak yardımcılar
```
