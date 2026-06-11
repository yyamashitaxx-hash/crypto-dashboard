// 仮想通貨YouTubeネタ ダッシュボード — 静的サイト生成スクリプト
// Exa(検索) + Anthropic(翻訳/整理) を使って dist/index.html を生成する。
// 実行: node generate.mjs   （環境変数 EXA_API_KEY, ANTHROPIC_API_KEY が必要）

import { writeFileSync, mkdirSync } from "node:fs";

const EXA_API_KEY = process.env.EXA_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-haiku-4-5-20251001";

if (!EXA_API_KEY) { console.error("ERROR: EXA_API_KEY が未設定です"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("ERROR: ANTHROPIC_API_KEY が未設定です"); process.exit(1); }

const NUM = 10;
const MAX_PER_GENRE = 14;
const GENRES = ["全体", "ビットコイン", "イーサリアム", "XRP", "アルトコイン"];

const GENRE_Q = {
  "全体": [
    "cryptocurrency total crypto market overview macro fed CPI sentiment liquidations news",
    "日本 暗号資産 仮想通貨 市場 規制 取引所 銀行 ステーブルコイン 最新ニュース"
  ],
  "ビットコイン": [
    "bitcoin BTC price ETF on-chain demand technical analysis news",
    "bitcoin news mining institutional treasury regulation latest"
  ],
  "イーサリアム": [
    "ethereum ETH price upgrade staking ETF layer2 news",
    "ethereum ecosystem defi restaking RWA developments news"
  ],
  "XRP": [
    "XRP ripple ETF CLARITY act regulation price news analysis",
    "ripple XRP ledger partnership payment adoption Japan SBI news"
  ],
  "アルトコイン": [
    "altcoin solana avalanche cardano monero top gainers news",
    "altcoin memecoin defi layer1 narrative movers news analysis"
  ]
};
const COLUMN_Q = [
  "crypto evergreen explainer feature tokenized stocks bonds RWA risk management staking tax analysis",
  "暗号資産 仮想通貨 解説 コラム トークン化 RWA ウォレット 作り方 リスク 税金 セキュリティ 初心者 ガイド",
  "crypto how-to guide wallet security cold storage scam protection beginner explainer"
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const esc = (s) => (s == null ? "" : String(s)).replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

async function exaSearch(query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": EXA_API_KEY },
        body: JSON.stringify({
          query, numResults: NUM, type: "auto",
          contents: { highlights: { numSentences: 3 }, text: { maxCharacters: 600 } }
        })
      });
      if (!res.ok) { await sleep(1500); continue; }
      const j = await res.json();
      return (j.results || []).map(r => ({
        title: r.title || "",
        url: r.url || "",
        snippet: String(
          (Array.isArray(r.highlights) ? r.highlights.join(" ") : r.highlights) || r.text || ""
        ).replace(/\s+/g, " ").trim().slice(0, 240)
      })).filter(r => r.title && r.url);
    } catch (e) { await sleep(1500); }
  }
  return [];
}

function dedupe(recs) {
  const seen = new Set(), out = [];
  for (const r of recs) {
    const k = (r.url || r.title).toLowerCase().replace(/[#?].*$/, "");
    if (seen.has(k)) continue; seen.add(k); out.push(r);
  }
  return out;
}

async function anthropic(prompt) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 3000, messages: [{ role: "user", content: prompt }] })
      });
      if (!res.ok) { await sleep(2000); continue; }
      const j = await res.json();
      return (j.content || []).map(c => c.text || "").join("");
    } catch (e) { await sleep(2000); }
  }
  return "";
}

function extractJSONArray(s) {
  if (!s) return null;
  let t = String(s).trim();
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (f) t = f[1].trim();
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a < 0 || b < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

async function translateGenre(g, recs) {
  const list = recs.slice(0, 16).map((r, i) => `${i + 1}. ${r.title} :: ${(r.snippet || "").slice(0, 140)}`).join("\n");
  const prompt =
`次は「${g}」の記事一覧。各記事を日本語化してJSON配列のみで返す（説明文・コードフェンス禁止）。
- 同一事象・ほぼ同内容は代表1件に統合（重複排除）。切り口が違うものは残す。
- できるだけ多く残す（最大${MAX_PER_GENRE}件）。
- "i"は元の番号、"t"は日本語タイトル、"s"は日本語要約1文。
形式: [{"i":1,"t":"...","s":"..."}]
記事:
${list}`;
  const arr = extractJSONArray(await anthropic(prompt));
  if (!Array.isArray(arr) || !arr.length) {
    return recs.slice(0, MAX_PER_GENRE).map(r => ({ category: g, title: r.title, summary: r.snippet, source: domain(r.url), url: r.url }));
  }
  const out = [];
  for (const o of arr) {
    const r = recs[(parseInt(o.i, 10) || 0) - 1]; if (!r) continue;
    out.push({ category: g, title: o.t || r.title, summary: o.s || r.snippet, source: domain(r.url), url: r.url });
  }
  return (out.length ? out : recs.slice(0, MAX_PER_GENRE).map(r => ({ category: g, title: r.title, summary: r.snippet, source: domain(r.url), url: r.url }))).slice(0, MAX_PER_GENRE);
}

async function buildColumns(recs) {
  const list = recs.slice(0, 18).map((r, i) => `${i + 1}. ${r.title} :: ${(r.snippet || "").slice(0, 140)}`).join("\n");
  const prompt =
`次の記事一覧から“速報ではない・いつでも使えるコラム/解説/ハウツー”だけを選ぶ（例: トークン化株/債券・RWA、リスク管理、ウォレット作成手順、ステーキング入門、税金、セキュリティ/詐欺対策、初心者向け解説）。日々の価格・値動きニュースは除外。各々日本語化。JSON配列のみ:
[{"i":元番号,"t":"日本語タイトル","s":"日本語要約1文"}] 最大12件。
記事:
${list}`;
  const arr = extractJSONArray(await anthropic(prompt));
  if (!Array.isArray(arr) || !arr.length) return recs.slice(0, 8).map(r => ({ category: "コラム", title: r.title, summary: r.snippet, source: domain(r.url), url: r.url }));
  const out = [];
  for (const o of arr) { const r = recs[(parseInt(o.i, 10) || 0) - 1]; if (!r) continue; out.push({ category: "コラム", title: o.t || r.title, summary: o.s || r.snippet, source: domain(r.url), url: r.url }); }
  return out.slice(0, 12);
}

async function buildIdeas(genres, columns) {
  const lines = [];
  for (const g of GENRES) (genres[g] || []).slice(0, 6).forEach(n => lines.push(`[${g}] ${n.title} — ${n.summary || ""}`));
  (columns || []).slice(0, 5).forEach(n => lines.push(`[コラム] ${n.title}`));
  if (!lines.length) return [];
  const prompt =
`以下は本日収集した仮想通貨ニュース/コラムの見出し。仮想通貨投資YouTubeの動画ネタを価値の高い順に6〜8件提案。各ネタにキャッチーな日本語タイトル、why(なぜネタになるか1-2文)、priority(hot/high/mid)、sources(媒体名配列)。JSON配列のみ:
[{"title":"日本語","why":"日本語1-2文","priority":"hot|high|mid","sources":["媒体名"]}]
見出し:
${lines.join("\n").slice(0, 6000)}`;
  const arr = extractJSONArray(await anthropic(prompt));
  return Array.isArray(arr) ? arr.slice(0, 8) : [];
}

function itemCard(n) {
  const link = n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">記事を開く ↗</a>` : "";
  return `<div class="item"><h4>${esc(n.title)}</h4><p>${esc(n.summary || "")}</p>
    <div class="src"><span class="tag">${esc(n.category || "")}</span>${esc(n.source || "")} ${link}</div></div>`;
}
function ideaCard(it, i) {
  const p = (it.priority || "mid").toLowerCase();
  const label = p === "hot" ? "HOT" : p === "high" ? "注目" : "定番";
  const src = (it.sources || []).join(" / ");
  return `<div class="idea"><div class="rank">${i + 1}</div><div>
    <h3>${esc(it.title)}<span class="prio ${esc(p)}">${label}</span></h3>
    <div class="why">${esc(it.why || "")}</div>${src ? `<div class="meta">関連ソース: ${esc(src)}</div>` : ""}</div></div>`;
}

function renderHTML(data) {
  const updated = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });
  const tabs = GENRES.map((g, i) =>
    `<button class="tab${i === 0 ? " active" : ""}" data-g="${esc(g)}">${esc(g)}<span class="cnt">${(data.genres[g] || []).length}</span></button>`).join("");
  const panels = GENRES.map((g, i) => {
    const list = data.genres[g] || [];
    const inner = list.length ? list.map(itemCard).join("") : `<div class="empty">新着なし</div>`;
    return `<div class="panel cat-grid" data-g="${esc(g)}" style="${i === 0 ? "" : "display:none"}">${inner}</div>`;
  }).join("");
  const ideas = (data.ideas || []).map(ideaCard).join("");
  const columns = (data.columns || []).map(itemCard).join("") || `<div class="empty">候補なし</div>`;

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>仮想通貨YouTubeネタ ダッシュボード</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;background:#f5f6f8;color:#1a1d24;line-height:1.6;padding:20px;max-width:1100px;margin:0 auto}
a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}
header{background:linear-gradient(135deg,#1e293b,#334155);color:#fff;border-radius:14px;padding:22px 24px;margin-bottom:18px}
header h1{font-size:22px;margin-bottom:4px}header .sub{font-size:13px;color:#cbd5e1}
.updated{font-size:12.5px;margin:0 0 16px;color:#64748b}
section{margin-bottom:28px}
.sec-title{font-size:16px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px;padding-bottom:6px;border-bottom:2px solid #e2e8f0}
.sec-title .badge{font-size:11px;font-weight:600;color:#fff;background:#64748b;border-radius:6px;padding:2px 8px}
.cards{display:grid;gap:12px}
.idea{background:#fff;border-radius:12px;padding:16px 18px;border:1px solid #e6e8ec;box-shadow:0 1px 2px rgba(0,0,0,.04);display:flex;gap:14px}
.idea .rank{font-size:24px;font-weight:800;color:#2563eb;min-width:34px}
.idea h3{font-size:16px;margin-bottom:6px}.idea .why{font-size:13.5px;color:#475569}.idea .meta{font-size:12px;color:#94a3b8;margin-top:8px}
.prio{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;margin-left:8px;vertical-align:middle;white-space:nowrap}
.prio.hot{background:#fee2e2;color:#dc2626}.prio.high{background:#ffedd5;color:#ea580c}.prio.mid{background:#e0f2fe;color:#0369a1}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.tab{font-size:13.5px;font-weight:600;padding:7px 16px;border-radius:999px;border:1px solid #d8dee7;background:#fff;color:#475569;cursor:pointer}
.tab.active{background:#1e293b;color:#fff;border-color:#1e293b}.tab .cnt{font-size:11px;opacity:.7;margin-left:4px}
.cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.item{background:#fff;border-radius:10px;padding:14px 16px;border:1px solid #e6e8ec}
.item h4{font-size:14.5px;margin-bottom:5px}.item p{font-size:13px;color:#475569}.item .src{font-size:11.5px;color:#94a3b8;margin-top:7px}
.tag{display:inline-block;font-size:10.5px;font-weight:600;background:#eef2ff;color:#4338ca;border-radius:5px;padding:1px 7px;margin-right:5px}
.col-wrap{background:#fffdf7;border:1px solid #f3e8c8;border-radius:14px;padding:16px 18px}
.col-wrap .lead{font-size:12.5px;color:#92722b;margin-bottom:12px}
.empty{font-size:13px;color:#94a3b8;padding:10px 2px}
footer{text-align:center;font-size:12px;color:#94a3b8;margin-top:30px;padding-top:16px;border-top:1px solid #e2e8f0}
</style></head><body>
<header><h1>🎬 仮想通貨YouTubeネタ ダッシュボード</h1>
<div class="sub">仮想通貨投資チャンネル向け｜web横断取得 → 重複排除 → 英語は日本語訳 → コイン別＆コラムに整理</div></header>
<div class="updated">最終更新: ${esc(updated)}（毎日自動更新）</div>

<section><div class="sec-title">🏆 YouTubeネタ候補（優先度順）</div><div class="cards">${ideas}</div></section>

<section><div class="sec-title">📰 ニュース（コイン別） <span class="badge">重複排除＋英→日 翻訳済</span></div>
<div class="tabs">${tabs}</div>${panels}</section>

<section><div class="sec-title">📚 コラム／エバーグリーン <span class="badge">いつでも使えるネタ</span></div>
<div class="col-wrap"><div class="lead">速報ではなく、後日でも上げられる解説・考察・ハウツー（トークン化株/債券、リスク管理、ウォレット作成、RWA入門、税金 など）</div>
<div class="cat-grid">${columns}</div></div></section>

<footer>仮想通貨YouTubeネタ ダッシュボード ・ 毎日自動更新（GitHub Actions）・ Xは対象外</footer>
<script>
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  const g=b.dataset.g;
  document.querySelectorAll(".panel").forEach(p=>p.style.display=(p.dataset.g===g?"":"none"));
});
</script>
</body></html>`;
}

async function main() {
  console.log("収集開始…");
  const genres = {};
  for (const g of GENRES) {
    const recsArrays = [];
    for (const q of GENRE_Q[g]) recsArrays.push(await exaSearch(q));
    const recs = dedupe(recsArrays.flat());
    console.log(`  ${g}: ${recs.length}件 取得`);
    genres[g] = await translateGenre(g, recs);
  }

  const colArrays = [];
  for (const q of COLUMN_Q) colArrays.push(await exaSearch(q));
  const colRecs = dedupe(colArrays.flat());
  console.log(`  コラム: ${colRecs.length}件 取得`);
  const columns = await buildColumns(colRecs);

  const ideas = await buildIdeas(genres, columns);

  const html = renderHTML({ genres, columns, ideas });
  mkdirSync("dist", { recursive: true });
  writeFileSync("dist/index.html", html, "utf-8");
  const total = GENRES.reduce((s, g) => s + (genres[g] || []).length, 0);
  console.log(`完了: ニュース${total}件 + コラム${columns.length}件 + ネタ${ideas.length}件 → dist/index.html`);
}

main().catch(e => { console.error(e); process.exit(1); });
