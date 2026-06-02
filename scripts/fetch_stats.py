#!/usr/bin/env python3
"""
Kozminik#tft Viego statlarını u.gg'den çeker, stats.json yazar.
Frontend stats.json'ı fetch edip header/KDA değerlerini live olarak günceller.

Kullanım:
    python3 scripts/fetch_stats.py

Cron (yerelde):
    crontab -e
    0 8 * * *  cd ~/Desktop/otpviego && python3 scripts/fetch_stats.py
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone

GAME_NAME = "Kozminik"
TAG_LINE  = "tft"
REGION    = "tr1"
SEASON_ID = 26          # u.gg current season — yeni sezonda güncelle
VIEGO_ID  = 234

URL = f"https://u.gg/lol/profile/{REGION}/{GAME_NAME}-{TAG_LINE}/overview"
UA  = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"


def fetch_html() -> str:
    req = urllib.request.Request(URL, headers={
        "User-Agent": UA,
        "Accept-Language": "tr-TR,tr;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8")


def parse(html: str) -> dict:
    m = re.search(r"window\.__APOLLO_STATE__\s*=\s*({.+?});?\s*</script", html, re.S)
    if not m:
        raise SystemExit("u.gg Apollo state bulunamadı — sayfa yapısı değişmiş olabilir.")
    state = json.loads(m.group(1))
    root  = state.get("ROOT_QUERY", {})

    # Solo queue rank
    ranks_key = next(
        (k for k in root if k.startswith("fetchProfileRanks") and f'"{GAME_NAME}"' in k and f'"seasonId":{SEASON_ID}' in k),
        None
    )
    solo = None
    if ranks_key:
        for r in root[ranks_key].get("rankScores", []):
            if r.get("queueType") == "ranked_solo_5x5":
                solo = r
                break

    # Champion stats — find Viego
    stats_key = next((k for k in root if k.startswith("fetchPlayerStatistics")), None)
    viego = None
    if stats_key:
        stats = root[stats_key]
        if isinstance(stats, list) and stats:
            for c in stats[0].get("basicChampionPerformances", []):
                if c.get("championId") == VIEGO_ID:
                    viego = c
                    break

    out = {"updated_at": datetime.now(timezone.utc).isoformat(), "rank": None, "viego": None}

    if solo:
        total = (solo["wins"] or 0) + (solo["losses"] or 0)
        out["rank"] = {
            "tier":   solo["tier"],
            "division": solo["rank"],
            "lp":     solo["lp"],
            "wins":   solo["wins"],
            "losses": solo["losses"],
            "wr":     round(100 * solo["wins"] / total, 1) if total else 0,
        }
    if viego:
        n = viego["totalMatches"] or 1
        out["viego"] = {
            "games":  viego["totalMatches"],
            "wins":   viego["wins"],
            "kills":  viego["kills"],
            "deaths": viego["deaths"],
            "assists": viego["assists"],
            "k_avg":  round(viego["kills"]  / n, 1),
            "d_avg":  round(viego["deaths"] / n, 1),
            "a_avg":  round(viego["assists"] / n, 1),
            "wr":     round(100 * viego["wins"] / n, 1),
        }
    return out


def main():
    html = fetch_html()
    data = parse(html)
    if not data["rank"] and not data["viego"]:
        print("UYARI: hem rank hem Viego bulunamadı. JSON yazılmayacak.", file=sys.stderr)
        sys.exit(1)
    with open("stats.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("stats.json güncellendi:", json.dumps(data, ensure_ascii=False))


if __name__ == "__main__":
    main()
