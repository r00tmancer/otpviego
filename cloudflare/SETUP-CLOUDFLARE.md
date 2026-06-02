# Cloudflare Backend Setup (D1 + Workers)

Tüm bedava. **Kart istemez.** ~10dk.

Ne yapacağız:
1. Cloudflare hesabı aç
2. Node.js + wrangler CLI kur
3. D1 database (SQLite) yarat
4. Worker'ı deploy et
5. Worker URL'ini `index.html`'e yapıştır

> Görsel desteği yok — sadece metin yorumu + 5 yıldız + sahibin edit/sil. Bu yüzden R2'ya gerek yok.

## 1. Cloudflare hesabı

<https://dash.cloudflare.com/sign-up> → email + şifre. Kart sormaz. Email doğrula.

## 2. Node.js + wrangler

Node yoksa: <https://nodejs.org> → LTS sürümünü indir, kur.

```bash
cd ~/Desktop/otpviego/cloudflare
npm install
npx wrangler login
```

Tarayıcıda Cloudflare giriş + "Allow" → terminale döner.

## 3. D1 database

```bash
npx wrangler d1 create otpviego-comments
```

Çıktıdaki `database_id`'yi kopyala. `wrangler.toml` aç ve yapıştır:

```toml
[[d1_databases]]
binding = "DB"
database_name = "otpviego-comments"
database_id = "PASTE_HERE"
```

Şemayı kur:

```bash
npm run db:init
```

✅ "Successfully executed" görmeli.

## 4. Worker deploy

```bash
npm run deploy
```

Çıktıda Worker URL'i göreceksin:

```
https://otpviego-api.<senin-kullanici>.workers.dev
```

Bu URL'i kopyala.

## 5. Frontend'e bağla

`~/Desktop/otpviego/index.html` aç. JS bölümünde şu satırı bul:

```js
const API_URL = '';
```

Worker URL'ini içine yapıştır:

```js
const API_URL = 'https://otpviego-api.kozminik.workers.dev';
```

Sayfayı yenile → kırmızı uyarı kaybolur, yorum formu çalışır.

## Test

1. İsim yaz (boş = "Anonim Demir Viego"), yıldız seç, mesaj yaz, **GÖNDER**.
2. Yorum hemen feed'de görünmeli.
3. Senin yorumunda **Düzenle** + **Sil** butonları çıkar (token localStorage'inde).
4. Başkasının yorumunda butonlar gözükmez.
5. Tarayıcı verisini silersen kendi yorumlarına da edit/sil yapamazsın (token kayıp).
6. Filtre testi: "allah" veya "amk" yaz → "Yorum yasaklı içerik" hatası gelmeli.

## Yerel test (deploy etmeden)

Worker'ı localhost'ta çalıştır:

```bash
cd ~/Desktop/otpviego/cloudflare
npm run db:init:local
npm run dev
```

`http://127.0.0.1:8787` çalışır. `index.html`'de `API_URL`'ini geçici olarak buna çevir.

## Yorumları yönet (admin)

Sahip değilsen edit/sil yapamazsın — ama wrangler ile DB'ye doğrudan erişebilirsin:

Listele:
```bash
npx wrangler d1 execute otpviego-comments --remote \
  --command="SELECT id, name, substr(message,1,60) AS msg FROM comments ORDER BY created_at DESC LIMIT 30"
```

Sil:
```bash
npx wrangler d1 execute otpviego-comments --remote \
  --command="DELETE FROM comments WHERE id = 5"
```

Hepsini temizle:
```bash
npx wrangler d1 execute otpviego-comments --remote --command="DELETE FROM comments"
```

## Filtre güncelle (yeni yasaklı kelime ekle)

İKİ yerde de güncellemen lazım — biri server, biri client. Aksi takdirde server reddeder ama client önce uyarı vermez (kötü UX).

- `cloudflare/src/worker.js` → `BLOCK_PATTERNS` veya `BLOCK_WORDS` → sonra `npm run deploy`
- `index.html` → aynı isimli iki dizi → kaydet

## Free tier limitleri

| Kaynak | Free limit | Sen |
|---|---|---|
| Worker requests | 100K/gün | ~100 |
| D1 storage | 5 GB | <1 MB |
| D1 writes | 100K/gün | ~10 |

Yıllarca free tier sınırına çarpmazsın.
