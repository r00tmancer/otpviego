// otpviego API — Cloudflare Worker (D1 + IP-bazlı identity)
//
// Kimlik: Cloudflare'in `CF-Connecting-IP` header'ını SHA-256(ip + salt) ile hashleyip kullanırız.
// Bu sayede:
//   - Aynı IP'den birden fazla yorum POST'lanamaz (gizli sekme dahil)
//   - Kendi IP'sinden gelen kişi kendi yorumunu beğenemez
//   - Edit/sil: hem X-Edit-Token hem IP eşleşmesi kabul (laptop home→work senaryosu)
//
// Endpoints:
//   GET    /api/summary               → {count, average, distribution}
//   GET    /api/comments              → list + your_vote/is_yours (IP'ne göre)
//   POST   /api/comments              → {name, message, stars} → {ok, id, edit_token}
//                                       409 → bu IP'den zaten yorum var, {existing_id} döner
//   PATCH  /api/comments/:id          → {message}   header: X-Edit-Token (veya IP eşleşmesi)
//   DELETE /api/comments/:id          → header: X-Edit-Token (veya IP eşleşmesi)
//                                       comment + ilgili tüm reactions silinir
//   POST   /api/comments/:id/react    → {kind: 'like'|'dislike'|null}
//                                       sahibi olduğun yoruma 403; yoksa upsert reactions

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Edit-Token',
  'Access-Control-Max-Age': '86400',
};

const MAX_NAME    = 40;
const MAX_MESSAGE = 500;
const MAX_BODY    = 4096;
const IP_SALT     = 'otpviego-v1-2026';  // değişirse tüm IP eşleşmeleri sıfırlanır

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (request.method !== 'GET' && request.method !== 'DELETE') {
      const cl = parseInt(request.headers.get('content-length') || '0', 10);
      if (cl > MAX_BODY) return json({ error: `Body çok büyük (max ${MAX_BODY} byte).` }, 413);
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/summary' && request.method === 'GET') {
        return json(await getSummary(env));
      }
      if (url.pathname === '/api/comments' && request.method === 'GET') {
        return json(await listComments(request, env));
      }
      if (url.pathname === '/api/comments' && request.method === 'POST') {
        return json(await createComment(request, env));
      }

      const reactMatch = url.pathname.match(/^\/api\/comments\/(\d+)\/react$/);
      if (reactMatch && request.method === 'POST') {
        return json(await reactComment(parseInt(reactMatch[1], 10), request, env));
      }

      const editMatch = url.pathname.match(/^\/api\/comments\/(\d+)$/);
      if (editMatch) {
        const id = parseInt(editMatch[1], 10);
        if (request.method === 'PATCH')  return json(await updateComment(id, request, env));
        if (request.method === 'DELETE') return json(await deleteComment(id, request, env));
      }

      if (url.pathname === '/' || url.pathname === '/api') {
        return json({ ok: true, msg: 'otpviego API çalışıyor' });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: e.message || 'bilinmeyen hata', ...(e.extra || {}) }, e.status || 400);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });
}
function fail(msg, status = 400, extra) {
  const e = new Error(msg); e.status = status; if (extra) e.extra = extra; return e;
}

// ---------- IP helper ----------

async function getIpHash(request) {
  // Cloudflare guarantees CF-Connecting-IP for incoming requests
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || '0.0.0.0';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + IP_SALT));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// ---------- handlers ----------

async function getSummary(env) {
  const r = await env.DB.prepare(`
    SELECT
      COUNT(*) AS count,
      AVG(stars) AS average,
      SUM(CASE WHEN stars = 1 THEN 1 ELSE 0 END) AS s1,
      SUM(CASE WHEN stars = 2 THEN 1 ELSE 0 END) AS s2,
      SUM(CASE WHEN stars = 3 THEN 1 ELSE 0 END) AS s3,
      SUM(CASE WHEN stars = 4 THEN 1 ELSE 0 END) AS s4,
      SUM(CASE WHEN stars = 5 THEN 1 ELSE 0 END) AS s5
    FROM comments
  `).first();
  return {
    count:   r.count || 0,
    average: r.average == null ? 0 : Math.round(r.average * 10) / 10,
    distribution: {
      '1': r.s1 || 0, '2': r.s2 || 0, '3': r.s3 || 0, '4': r.s4 || 0, '5': r.s5 || 0
    },
  };
}

async function listComments(request, env) {
  const ip_hash = await getIpHash(request);
  // LEFT JOIN reactions → bu IP'nin oyu (your_vote: like/dislike/null)
  // is_yours: 1 ise sahibim, frontend reaction butonlarını gizler ve edit/sil gösterir
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.created_at, c.name, c.message, c.stars, c.likes, c.dislikes,
            r.kind AS your_vote,
            CASE WHEN c.ip_hash = ? THEN 1 ELSE 0 END AS is_yours
       FROM comments c
       LEFT JOIN reactions r ON r.comment_id = c.id AND r.ip_hash = ?
       ORDER BY (c.likes - c.dislikes) DESC, c.created_at DESC
       LIMIT 100`
  ).bind(ip_hash, ip_hash).all();
  return results;
}

async function createComment(request, env) {
  const ip_hash = await getIpHash(request);

  // 1 IP = 1 yorum politikası
  const existing = await env.DB.prepare(
    'SELECT id FROM comments WHERE ip_hash = ? LIMIT 1'
  ).bind(ip_hash).first();
  if (existing) {
    throw fail(
      'Bu IP\'den zaten bir yorumun var. Eskisini düzenleyebilir ya da silebilirsin.',
      409,
      { existing_id: existing.id }
    );
  }

  let body;
  try { body = await request.json(); } catch { throw fail('JSON parse hatası'); }

  if (body.name != null && typeof body.name !== 'string')       throw fail('name string olmalı.');
  if (body.message != null && typeof body.message !== 'string') throw fail('message string olmalı.');
  if (typeof body.stars !== 'number' || !Number.isInteger(body.stars)) {
    throw fail('stars tam sayı olmalı (1-5).');
  }

  const name    = (body.name || 'Anonim Demir Viego').slice(0, MAX_NAME).trim() || 'Anonim Demir Viego';
  const message = (body.message || '').slice(0, MAX_MESSAGE).trim();
  const stars   = body.stars;

  if (!message)                    throw fail('Mesaj boş olamaz.');
  if (!(stars >= 1 && stars <= 5)) throw fail('Yıldız 1-5 arası olmalı.');

  const bad = contentBlocked(name + ' ' + message);
  if (bad) throw fail(`Yorum yasaklı içerik içeriyor (${bad}).`);

  const created_at = Date.now();
  const edit_token = crypto.randomUUID();

  const r = await env.DB.prepare(
    `INSERT INTO comments (created_at, name, message, stars, edit_token, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(created_at, name, message, stars, edit_token, ip_hash).run();

  return { ok: true, id: r.meta.last_row_id, created_at, edit_token };
}

async function updateComment(id, request, env) {
  const ip_hash = await getIpHash(request);
  const token   = request.headers.get('X-Edit-Token') || '';

  const row = await env.DB.prepare(
    'SELECT edit_token, ip_hash FROM comments WHERE id = ?'
  ).bind(id).first();
  if (!row) throw fail('Yorum bulunamadı', 404);

  // Token VEYA aynı IP → yetkili
  const isOwner = (token && token === row.edit_token) || (row.ip_hash && row.ip_hash === ip_hash);
  if (!isOwner) throw fail('Bu yorum sana ait değil.', 403);

  let body;
  try { body = await request.json(); } catch { throw fail('JSON parse hatası'); }
  if (body.message != null && typeof body.message !== 'string') throw fail('message string olmalı.');
  const message = (body.message || '').slice(0, MAX_MESSAGE).trim();
  if (!message) throw fail('Mesaj boş olamaz.');

  const bad = contentBlocked(message);
  if (bad) throw fail(`Yorum yasaklı içerik içeriyor (${bad}).`);

  await env.DB.prepare('UPDATE comments SET message = ? WHERE id = ?').bind(message, id).run();
  return { ok: true };
}

async function deleteComment(id, request, env) {
  const ip_hash = await getIpHash(request);
  const token   = request.headers.get('X-Edit-Token') || '';

  const row = await env.DB.prepare(
    'SELECT edit_token, ip_hash FROM comments WHERE id = ?'
  ).bind(id).first();
  if (!row) throw fail('Yorum bulunamadı', 404);

  const isOwner = (token && token === row.edit_token) || (row.ip_hash && row.ip_hash === ip_hash);
  if (!isOwner) throw fail('Bu yorum sana ait değil.', 403);

  // Önce reactions, sonra comment (FK manuel)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reactions WHERE comment_id = ?').bind(id),
    env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id),
  ]);
  return { ok: true };
}

async function reactComment(id, request, env) {
  const ip_hash = await getIpHash(request);

  let body;
  try { body = await request.json(); } catch { throw fail('JSON parse hatası'); }
  const kind = body.kind === undefined ? null : body.kind;
  if (kind !== null && kind !== 'like' && kind !== 'dislike') {
    throw fail('kind geçersiz (like/dislike/null)');
  }

  const comment = await env.DB.prepare(
    'SELECT ip_hash FROM comments WHERE id = ?'
  ).bind(id).first();
  if (!comment) throw fail('Yorum bulunamadı', 404);

  // Self-vote engeli (IP eşleşmesi)
  if (comment.ip_hash && comment.ip_hash === ip_hash) {
    throw fail('Kendi yorumuna oy veremezsin.', 403);
  }

  // Önceki tepkiyi DB'den oku (client'a güvenme)
  const prev = await env.DB.prepare(
    'SELECT kind FROM reactions WHERE ip_hash = ? AND comment_id = ?'
  ).bind(ip_hash, id).first();
  const prevKind = prev?.kind || null;

  if (prevKind === kind) {
    // Değişiklik yok — sadece sayaçları döndür
    const c = await env.DB.prepare(
      'SELECT likes, dislikes FROM comments WHERE id = ?'
    ).bind(id).first();
    return { ok: true, likes: c.likes, dislikes: c.dislikes, your_vote: kind };
  }

  let dLikes = 0, dDislikes = 0;
  if (prevKind === 'like')    dLikes--;
  if (prevKind === 'dislike') dDislikes--;
  if (kind === 'like')        dLikes++;
  if (kind === 'dislike')     dDislikes++;

  // Reactions tablosunda upsert/delete
  if (kind === null) {
    await env.DB.prepare(
      'DELETE FROM reactions WHERE ip_hash = ? AND comment_id = ?'
    ).bind(ip_hash, id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO reactions (ip_hash, comment_id, kind, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ip_hash, comment_id) DO UPDATE SET
         kind = excluded.kind,
         created_at = excluded.created_at`
    ).bind(ip_hash, id, kind, Date.now()).run();
  }

  // Counter güncelle (negatif drift'i engelle)
  const r = await env.DB.prepare(
    `UPDATE comments
        SET likes    = MAX(0, likes    + ?),
            dislikes = MAX(0, dislikes + ?)
      WHERE id = ?
      RETURNING likes, dislikes`
  ).bind(dLikes, dDislikes, id).first();

  return { ok: true, likes: r.likes, dislikes: r.dislikes, your_vote: kind };
}

// ---------- içerik filtresi (dini + küfür) ----------
// index.html'deki normalize() ile aynı. Birinde değişiklik yaparsan ikisini de güncelle.

const LEET = { '@':'a','4':'a','0':'o','3':'e','1':'i','!':'i','|':'i','$':'s','5':'s','7':'t','ß':'b' };

function normalize(s) {
  let n = String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[ıîi̇]/g, 'i').replace(/[şŝ]/g, 's').replace(/[çĉ]/g, 'c')
    .replace(/[öô]/g, 'o').replace(/[üû]/g, 'u').replace(/[ğĝ]/g, 'g')
    .replace(/[αа]/g, 'a').replace(/[βв]/g, 'b').replace(/[сcс]/g, 'c').replace(/[еeе]/g, 'e')
    .replace(/[gɡ]/g, 'g').replace(/[hн]/g, 'h').replace(/[іi]/g, 'i').replace(/[jј]/g, 'j')
    .replace(/[κk]/g, 'k').replace(/[lӏ]/g, 'l').replace(/[мm]/g, 'm').replace(/[пn]/g, 'n')
    .replace(/[оo]/g, 'o').replace(/[ρp]/g, 'p').replace(/[qԛ]/g, 'q').replace(/[rг]/g, 'r')
    .replace(/[ѕs]/g, 's').replace(/[тt]/g, 't').replace(/[υu]/g, 'u').replace(/[νv]/g, 'v')
    .replace(/[wш]/g, 'w').replace(/[xх]/g, 'x').replace(/[yу]/g, 'y').replace(/[zz]/g, 'z');
  n = n.replace(/[@4031!|$57ß]/g, c => LEET[c] || c);
  n = n.replace(/[​-‏‪-‮⁠﻿]/g, '');
  return n.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const BLOCK_PATTERNS = [
  'allah','alah','allh','peygamber','muhammed','muhammet','hzmuhammed','hzmuh','kuran','quran','islamiyet',
  'amk','amq','amina','aminakoyim','aminakoyayim','amcik','amcuk',
  'siktir','sktr','sikerim','sikeyim','siker','sikim','sikimde','sikiyim',
  'piccocugu','piccocu','pickurusu','orospu','oruspu','oruspucocugu','orospucocugu',
  'occocugu','occocu',
  'anani','ananiskm','ananiskeyim','ananiziki','ananin','annenisikim','annenibab',
  'bacini','bacniskeyim','bacniskm',
  'kahpe','serefsiz','gavat','pezevenk',
  'yarrak','yarak','yrak','gotveren','gotlek','ibne','ibe',
  'amciq','aminoglu','ammk','amciginis',
];
const BLOCK_WORDS = new Set(['mk','aq','oc','oe','pic','sik']);

function contentBlocked(text) {
  const lower = normalize(text);
  const tokens = lower.split(/[^a-z]+/).filter(Boolean);
  for (const t of tokens) if (BLOCK_WORDS.has(t)) return t;
  const compact = lower.replace(/[^a-z]/g, '');
  for (const p of BLOCK_PATTERNS) if (compact.includes(p)) return p;
  return null;
}
