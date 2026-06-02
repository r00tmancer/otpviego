# Otomatik Stat Güncelleme

`stats.json` dosyası Viego rank + KDA + win-rate verilerini tutar. Site her sayfa yüklendiğinde bu dosyayı fetch eder ve KDA bölümünü canlı günceller.

## Manuel güncelleme (en basit)

Terminalde:

```bash
cd ~/Desktop/otpviego
python3 scripts/fetch_stats.py
```

`stats.json` yeniden yazılır. Site sayfayı reload et → yeni değerler görünür.

> Stat değişmediyse JSON içeriği aynı kalır, sorun yok.

## Yerel cron (otomatik)

macOS'ta her gün sabah 8'de güncellesin:

```bash
crontab -e
```

Şunu ekle (`i` ile yazma moduna geç, yapıştır, `Esc`, `:wq`):

```cron
0 8 * * *  cd /Users/kerpetenes/Desktop/otpviego && /usr/bin/python3 scripts/fetch_stats.py >> /tmp/viego-stats.log 2>&1
```

Logları kontrol etmek için: `tail -f /tmp/viego-stats.log`

> Mac'in açık olması lazım — uyurken çalışmaz. Kapalı bilgisayar için **GitHub Action** kullan.

## GitHub Action (sunucu üzerinden, en güvenilir)

Site GitHub'da host'lanıyorsa (Pages / Netlify / Vercel):

1. Repo'yu GitHub'a push et — `.github/workflows/refresh-stats.yml` zaten içinde.
2. Repo → **Settings → Actions → General → Workflow permissions** → ✅ **Read and write permissions** → Save.
3. Repo → **Actions** sekmesine git → **Refresh Viego stats** workflow'ı görmelisin.
4. **Run workflow** ile manuel test et — `stats.json` güncellenip commit gelmeli.
5. Cron her gün 08:00 (TR) otomatik çalışacak.

## stats.json formatı

```json
{
  "updated_at": "2026-05-23T23:33:35.919205+00:00",
  "rank": {
    "tier": "EMERALD", "division": "II", "lp": 72,
    "wins": 61, "losses": 50
  },
  "viego": {
    "games": 8, "wins": 7,
    "kills": 119, "deaths": 44, "assists": 52,
    "k_avg": 14.9, "d_avg": 5.5, "a_avg": 6.5,
    "wr": 87.5
  }
}
```

Frontend `[data-stat="..."]` selector'larıyla bu alanları okur. Yapı `index.html` içindeki `fetch('stats.json')` bloğunda.

## Yeni sezon geldiğinde

Riot her ~6 ayda bir yeni sezon açar. `scripts/fetch_stats.py` içindeki:

```python
SEASON_ID = 26
```

değerini yeni sezon ID'siyle güncelle. u.gg'nin URL'inden veya HTML'inden bakabilirsin.

## u.gg yapısı değişirse

u.gg `window.__APOLLO_STATE__` blob'unu sayfaya gömüyor — scraper bu blob'u regex ile çekiyor. u.gg frontend'i React/Next.js refactor ederse format değişebilir, o zaman:

1. `curl -A 'Mozilla/5.0' 'https://u.gg/lol/profile/tr1/Kozminik-tft/overview' -o /tmp/ugg.html`
2. `/tmp/ugg.html` içinde rank/KDA verilerinin nasıl gömüldüğüne bak.
3. `scripts/fetch_stats.py`'i ona göre güncelle.

Yedek plan: Riot resmi API (https://developer.riotgames.com — kayıt ücretsiz, dev key 24 saat geçerli). Bu route daha kararlı ama anahtar yönetimi gerekiyor.

## Stats güncellenmezse ne olur?

Frontend `fetch('stats.json').catch(() => {})` ile silently fall-back yapıyor — `index.html`'de baked değerler (`data-stat` attribute'lu elemanların `textContent`'i) gösterilir. Yani scraper bozulsa bile site açılır.
