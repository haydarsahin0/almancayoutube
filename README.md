# 📖 Almanca Okuyucu

Telefon ve tablette çalışan, kurulum gerektirmeyen bir Almanca okuma uygulaması.

PDF, EPUB veya TXT dosyası yüklersin; kitap **gerçek bir kitap gibi sayfa sayfa** açılır.
Metindeki **herhangi bir kelimeye dokunduğunda** yapay zeka o kelimeyi sana öğretir:

- Kelimenin **seviyesi** (A1…C2 rozeti) ve günlük Almancada ne sıklıkta geçtiği
- Kelimenin **basit Almanca açıklaması** (seviyene göre — `Das Wetter sagt, ob es warm oder kalt ist.`)
- **Türkçe karşılıkları** ve o cümledeki anlamı
- **Her seviyeden eş anlamlılar**: aynı anlama gelen kelimeler A1'den C1'e doğru sıralı
  (`laufen` → `gehen` A1 · `rennen` A2 · `joggen` B1 · `sich fortbewegen` C1), her birinin
  Türkçesi ve kullanım farkıyla — kendi seviyene uygun olanı seçebilirsin
- **Kelime ailesi**: aynı kökten türeyen kelimeler (`laufen` → `der Lauf`, `der Läufer`,
  `weglaufen`, `die Laufbahn`), her biri Türkçesi ve seviyesiyle — dokununca o kelime de açılır
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

### Kelimelerim (aralıklı tekrar)

- Panelde **⭐** dediğin kelimeler burada birikir; kitapta işaretli görünürler.
- **🎴 Tekrara başla** → kart çalışması: üstte kelime, altında anlamı **bulanık**.
  Dokununca netleşir, sonra **😕 Bilmiyorum / 🙂 Biliyorum** dersin.
- **ℹ️ Bu kelime hakkında detay** ile tam açıklama panelini (eş anlamlılar, örnek
  cümleler, fiil çekimleri) çalışma sırasında da açabilirsin.
- Kartın açılan yüzünde kelimenin **eş anlamlıları** da seviyeleriyle görünür.
- **🔁 Eş anlamlı turu**: kelime gösterilir, "bunun yerine ne diyebilirsin?" diye sorulur;
  dokununca eş anlamlıları basitten ileriye doğru açılır. Bu tur tekrar takvimini etkilemez.
- Aralıklı tekrar (Leitner): bildiğin kelime **1 → 3 → 7 → 16 → 35 → 90 gün** sonra
  tekrar karşına çıkar; bilemediğin başa döner ve **aynı turda** tekrar sorulur.
  Böylece kelimeyi unutmadan hemen önce tekrar görürsün.
- Liste her kelimenin öğrenme durumunu (Yeni / Öğreniliyor / Biliniyor / Ustalaşıldı),
  dil seviyesini (A1…C2) ve bir sonraki tekrar zamanını gösterir; sıralamayı değiştirebilirsin.
- **⬇️ Dışa aktar / ⬆️ İçe aktar** ile kelime listeni yedekleyebilirsin.

### İstatistik

- Bugünün özeti: 🔥 günlük seri, okunan sayfa, okuma süresi, sorulan kelime.
- **Bugün tekrar edilmesi gereken kelime sayısı** ve oradan doğrudan çalışmaya başlama.
- **Son 14 gün** çubuk grafiği — sayfa / dakika / kelime arasında geçiş yapabilirsin.
- **Kelime ustalığı** dağılımı: kaç kelime hangi seviyede.
- Toplamlar: kitap, sayfa, okuma süresi, sorulan kelime, kelime defteri, tekrar, en uzun seri.
- Okuma süresi yalnızca kitap ekranı açıkken ve son 2,5 dakikada ekrana dokunmuşsan sayılır.

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
assets/js/srs.js        aralıklı tekrar (Leitner kutuları)
assets/js/stats.js      okuma takibi ve istatistik sayfası
assets/js/word.js       kelime paneli
assets/js/vocab.js      kelime defteri ve kartlar
assets/js/store.js      ayarlar, kayıtlar, kitaplık
assets/js/util.js       ortak yardımcılar
```
