# Tombala — Şansın en güzel hali

Gerçek zamanlı, çok oyunculu web tabanlı Tombala oyunu. Koyu lacivert & altın temalı, mobil öncelikli arayüz.

- **Veritabanı, giriş, canlı yayın ve otomatik çekiliş:** [Supabase](https://supabase.com) (PostgreSQL + Realtime + pg_cron)
- **Site barındırma:** [Cloudflare Pages](https://pages.cloudflare.com) (statik site, derleme gerekmez)
- Ayrı bir sunucu yoktur; bilgisayarınızın açık kalması gerekmez.

## Kurulum

### 1. Supabase projesi

1. supabase.com → **New project** (Region: Europe).
2. Proje açılınca **SQL Editor → New query**: `supabase/schema.sql` dosyasının **tamamını** yapıştırıp **Run**.
   - "Success" görmelisiniz. Dosya tekrar çalıştırılabilir; güncellemelerde yeniden çalıştırmak verileri silmez.
3. **Project Settings → API** (veya **API Keys**) sayfasından **Project URL** ve **anon / publishable** anahtarını alın.
   **`service_role` / `secret` anahtarını asla siteye koymayın.**

### 2. Site ayarı

`docs/js/config.js` dosyasına bu iki bilgiyi yazın:

```js
export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
export const SUPABASE_KEY = 'eyJ... veya sb_publishable_...';
```

### 3. Yayınlama

**GitHub Pages (en kolayı):** Repo → **Settings → Pages → Source: Deploy from a branch**, dal olarak varsayılan dalı ve klasör olarak **/docs** seçip **Save**.
Site `https://<kullanıcı-adı>.github.io/tombala/` adresinde açılır. (Ücretsiz hesapta repo herkese açık olmalıdır.)

**veya Cloudflare Pages:**

1. dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**, GitHub'daki `tombala` reposunu seçin.
2. Ayarlar:
   - **Framework preset:** None
   - **Build command:** _(boş bırakın)_
   - **Build output directory:** `docs`
3. **Save and Deploy** → `https://tombala.pages.dev` benzeri bir link alırsınız.
   GitHub'a her gönderimde site otomatik güncellenir.

### 4. İlk giriş

Siteyi açıp hemen **kayıt olun**: **ilk kayıt olan kullanıcı yönetici (admin) olur.**
Başka birini yönetici yapmak için Admin Paneli → Kullanıcılar → **Yönetici Yap**.

## Ekranlar

| # | Ekran | Rota |
|---|-------|------|
| 1 | Açılış (Başlayın) | `#/splash` |
| 2 | Hoş Geldiniz (+ giriş yapmadan **Canlı Çekilişi İzle**) | `#/welcome` |
| 3 | Kayıt Ol | `#/register` |
| 4 | Giriş Yap (Beni Hatırla, Şifremi Unuttum) | `#/login` |
| 5 | Ana Sayfa (bakiye, bildirimler, oyun durumu, havuz) | `#/home` |
| 6 | Kart Seçimi (1–100, önizleme, rastgele seç) | `#/select` |
| 7 | Seçiminiz Onaylanıyor… | `#/request/:id` |
| 8 | Admin Bildirimi (Onayla / Reddet) | yöneticiye otomatik |
| 9 | Ödemeniz Bekleniyor… (bakiyeden öde / havale bilgisi) | `#/request/:id` |
| 10 | Kartlarım | `#/cards` |
| 11 | Canlı Oyun — **giriş yapmadan da izlenebilir** | `#/game`, `#/izle` |
| 12 | KAZANDIN! | kazanınca otomatik |
| 13 | Kazananlar (Bu Hafta / Bu Ay / Tüm Zamanlar) | `#/winners` |
| 14 | Admin Paneli (Oyun Yönetimi, Kullanıcılar, Ödemeler, Ayarlar) | `#/admin` |
| 15 | Ayarlar (Bildirimler, Ses, Müzik, Sesli Okuma, Tema) | `#/settings` |
| 16 | Veda ekranı (çıkışta) | `#/bye` |

Ek olarak **Geçmiş** (`#/history`) ve **Profil** (`#/profile`).
İzleyicilere doğrudan `https://siteniz.pages.dev/#/izle` linkini gönderebilirsiniz.

## Oyun akışı

1. Oyuncu kayıt olur, **Kart Satın Al** ile 1–100 arasından kart seçer.
2. Talep yöneticinin ekranına bildirim olarak düşer → **Onayla / Reddet**.
3. Oyuncu **bakiyesinden öder** ya da havale/EFT yapar ve yönetici **Ödeme Alındı** der.
4. Yönetici **Oyun Başlat**'a basar (veya planlanan saatte otomatik başlar). Açık kalan talepler iptal edilir.
5. Supabase her saniye kontrol eder ve belirlenen aralıkla top çeker; kartlar otomatik işaretlenir.
6. **1. Çinko**, **2. Çinko** ve **Tombala** veritabanında otomatik tespit edilir, ödül kazananın bakiyesine eklenir.
   Aynı topta birden fazla kazanan varsa ödül paylaştırılır.
7. Tombala çıkınca oyun biter; yönetici **Yeni Oyun** ile yeni satışı başlatır.

Kartlar geleneksel düzendedir: 3 satır × 9 sütun, her satırda 5 sayı; sütunlar 1–9, 10–19 … 80–90.

## Havuz ve ödüller (Admin → Ayarlar)

- **Satışlardan (%)**: havuz = satılan kart geliri × oran (varsayılan %80) · **Sabit Tutar**: sabit havuz
- Dağılım varsayılanı: 1. Çinko %20 · 2. Çinko %30 · Tombala %50
- Kart bedeli, çekiliş aralığı, talep başına maksimum kart, otomatik onay ve ödeme (IBAN) bilgileri de buradan.
- Havuz ve oranlar oyun başladığı anda sabitlenir.

## Mimari ve güvenlik

```
docs/                 Yayınlanan statik site (GitHub Pages / Cloudflare / Vercel)
  js/config.js        Supabase URL + anon anahtarı
  js/backend.js       Supabase RPC, Realtime aboneliği ve yedek yoklama
  js/app.js           Tüm ekranlar
  js/ui.js, sound.js  Arayüz parçaları, ses efektleri, sesli okuma
  vendor/supabase.js  supabase-js 2.118.0
supabase/
  schema.sql          Tüm veritabanı kurulumu (tek dosya)
  test.sql            Uçtan uca SQL testleri
scripts/serve.js      Yerel önizleme sunucusu (npm start)
```

- Kullanıcılar, şifreler (bcrypt), oturumlar, talepler ve bakiyeler gizli `app` şemasındadır; API'den doğrudan erişilemez.
- Site yalnızca `public.tb_*` fonksiyonlarını çağırabilir; her fonksiyon oturumu ve yetkiyi kendisi denetler.
- Herkese açık tek tablo `public.games`'tir (yalnızca okunur) ve Realtime ile canlı yayınlanır.
- Otomatik çekiliş `pg_cron` ile her saniye çalışır. Herhangi bir sebeple çalışmazsa, oyunu izleyen tarayıcılar
  zamanı gelen topu yedek olarak tetikler.

## Sık karşılaşılanlar

- **"Supabase bağlantısı yapılandırılmamış"** → `docs/js/config.js` boş.
- **"Veritabanı kurulmamış"** → `supabase/schema.sql` SQL Editor'de çalıştırılmamış.
- **Ücretsiz Supabase projesi 1 hafta kullanılmazsa duraklatılır** → Supabase panelinden **Restore** ile tekrar açılır.
- Şifresini unutan kullanıcıya yönetici, Admin Paneli → Kullanıcılar → **Şifre Sıfırla** ile geçici şifre verir.

## Geliştirme

```bash
npm start                      # http://localhost:8080 (statik önizleme; config.js'teki Supabase'e bağlanır)
psql "<veritabanı bağlantı adresi>" -f supabase/schema.sql -f supabase/test.sql   # SQL testleri (geri alınır)
```

## Not

Uygulama ödemeleri kendisi tahsil etmez; bakiye ve ödeme onayları yönetici tarafından yönetilir.
Gerçek parayla oynatılacaksa yürürlükteki şans oyunları mevzuatına uyulması gerekir.
