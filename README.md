# Tombala — Şansın en güzel hali

Web tabanlı, gerçek zamanlı (çok oyunculu) Tombala oyunu. Koyu lacivert & altın temalı, mobil öncelikli arayüz;
Node.js + Express + Socket.IO sunucusu. Harici veritabanı gerektirmez (veriler `data/db.json` dosyasında tutulur).

## Hızlı başlangıç

```bash
npm install
npm start          # http://localhost:3000
```

> **İlk kayıt olan kullanıcı otomatik olarak yönetici (admin) olur.**
> İsterseniz `ADMIN_USERNAME` ve `ADMIN_PASSWORD` ortam değişkenleriyle başlangıçta bir yönetici hesabı da oluşturabilirsiniz.

Geliştirme için `npm run dev` (dosya değişince yeniden başlar), testler için `npm test`.

## Ekranlar

| # | Ekran | Rota |
|---|-------|------|
| 1 | Açılış (Başlayın) | `#/splash` |
| 2 | Hoş Geldiniz | `#/welcome` |
| 3 | Kayıt Ol | `#/register` |
| 4 | Giriş Yap (Beni Hatırla, Şifremi Unuttum) | `#/login` |
| 5 | Ana Sayfa (bakiye, bildirimler, oyun durumu, havuz) | `#/home` |
| 6 | Kart Seçimi (1–100, önizleme, rastgele seç) | `#/select` |
| 7 | Seçiminiz Onaylanıyor… | `#/request/:id` |
| 8 | Admin Bildirimi (Onayla / Reddet açılır penceresi) | admin için otomatik |
| 9 | Ödemeniz Bekleniyor… (bakiyeden öde / havale bilgisi) | `#/request/:id` |
| 10 | Kartlarım | `#/cards` |
| 11 | Canlı Oyun (küre, son 10 taş, sayaç, havuz) | `#/game` |
| 12 | KAZANDIN! | kazanınca otomatik |
| 13 | Kazananlar (Bu Hafta / Bu Ay / Tüm Zamanlar) | `#/winners` |
| 14 | Admin Paneli (Oyun Yönetimi, Kullanıcılar, Ödemeler, Ayarlar) | `#/admin` |
| 15 | Ayarlar (Bildirimler, Ses, Müzik, Sesli Okuma, Tema) | `#/settings` |
| 16 | Veda ekranı (çıkışta) | `#/bye` |

Ek olarak: **Geçmiş** (`#/history`) ve **Profil** (`#/profile`) ekranları.

## Oyun akışı

1. Oyuncu kayıt olur / giriş yapar, **Kart Satın Al** ile 1–100 arasından kart seçer.
2. Talep yöneticiye anlık bildirim olarak düşer → **Onayla / Reddet**.
3. Onaylanan talep için oyuncu **bakiyesinden öder** ya da havale/EFT yapar ve yönetici **Ödeme Alındı** der.
4. Yönetici **Oyun Başlat**'a basar (veya planlanan saatte otomatik başlar). Açık kalan talepler iptal edilir.
5. Sunucu belirlenen aralıkla top çeker; kartlar otomatik işaretlenir, sayılar istenirse sesli okunur.
6. **1. Çinko** (bir satır), **2. Çinko** (iki satır) ve **Tombala** (tüm kart) sunucu tarafından otomatik tespit edilir,
   ödül kazananların bakiyesine eklenir. Aynı topta birden fazla kazanan varsa ödül paylaştırılır.
7. Tombala çıkınca oyun biter; yönetici **Yeni Oyun** ile yeni satışı başlatır.

### Kartlar

Geleneksel tombala kartı: 3 satır × 9 sütun, her satırda 5 sayı (toplam 15). 1. sütun 1–9, 2. sütun 10–19 … 9. sütun 80–90.
Her oyun için 100 benzersiz kart üretilir.

### Havuz ve ödüller (Admin → Ayarlar)

- **Satışlardan (%)**: havuz = satılan kart geliri × oran (varsayılan %80)
- **Sabit Tutar**: yöneticinin belirlediği sabit havuz
- Dağılım varsayılanı: 1. Çinko %20 · 2. Çinko %30 · Tombala %50 (toplam %100 olmalı)
- Kart bedeli, çekiliş aralığı, talep başına maksimum kart, otomatik onay ve ödeme bilgileri de buradan ayarlanır.
- Havuz ve oranlar oyun başladığı anda sabitlenir.

## Yönetici işlemleri

- Oyun başlat / durdur (duraklat) / devam et, elle top çek, oyunu iptal et (ödenen kart bedelleri bakiyeye iade edilir), yeni oyun
- Çekiliş saati planlama
- Kart taleplerini onaylama, reddetme (sebep ile), ödemeyi onaylama
- Kullanıcılara bakiye ekleme/düşme, yönetici yapma, engelleme, geçici şifre oluşturma

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `PORT` | `3000` | Sunucu portu |
| `DATA_DIR` | `./data` | Veri dosyasının klasörü |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_NAME` | – | Başlangıçta yönetici hesabı oluşturur |
| `COOKIE_SECURE` | – | `1` ise oturum çerezi yalnızca HTTPS'te gönderilir (canlı ortamda önerilir) |
| `TRUST_PROXY` | – | Ters vekil (nginx vb.) arkasında `1` yapın |
| `TZ_OFFSET_MIN` | `180` | "Bu Hafta / Bu Ay" hesaplaması için saat dilimi (Türkiye: UTC+3) |

## Docker

```bash
docker build -t tombala .
docker run -p 3000:3000 -v tombala-data:/app/data tombala
```

## Proje yapısı

```
server/
  index.js    Express + Socket.IO sunucusu
  routes.js   REST API (kimlik doğrulama, oyun, talepler, admin)
  game.js     Oyun motoru: durumlar, çekiliş, ödül tespiti, talepler
  cards.js    Tombala kartı üretimi
  auth.js     Şifre (scrypt), oturum çerezleri
  db.js       JSON dosya deposu
public/
  index.html, css/style.css
  js/app.js   Tüm ekranlar ve yönlendirme
  js/ui.js    İkonlar, toplar, kartlar, modal, bildirimler
  js/sound.js Web Audio ses efektleri, müzik, sesli okuma
test/         node:test testleri
```

## Not

Uygulama ödemeleri kendisi tahsil etmez; bakiye ve ödeme onayları yönetici tarafından elle yönetilir.
Gerçek parayla oynatılacaksa yürürlükteki şans oyunları mevzuatına uyulması gerekir.
