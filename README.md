# otpviego

Viego OTP trol sitesi — `otpthresh.com`'un Viego klonu.

**Canlı:** https://kerpetenes.github.io/otpviego/

## Stack
- Frontend: tek dosya `index.html` (vanilla JS, hiç build yok)
- Backend: Cloudflare Worker + D1 (SQLite) — `cloudflare/` klasöründe
- Statlar: u.gg'den günde 6 kez scrape, GitHub Action ile `stats.json` güncelleniyor

## Özellikler
- Gerçek rank + KDA + win rate (Kozminik#tft TR)
- Yorum + 5 yıldız puan, dini/küfür filtresi (Türkçe + leetspeak + Unicode confusable)
- IP-bazlı identity: 1 IP = 1 yorum, kendi yorumuna oy yok, edit/sil cross-browser çalışır
- Trendyol-tarzı yıldız ortalama widget
- Reddit-tarzı ↑↓ vote, en çok beğenilen en üstte
- Worker'da Postgres-style atomik delta updates, content-length DoS guard, type checks

## Setup (kendi versiyonun için)
1. `cloudflare/SETUP-CLOUDFLARE.md` — D1 + Worker deploy
2. `SETUP-STATS.md` — günlük stat refresh

İlham: [otpthresh.com](https://otpthresh.com)
