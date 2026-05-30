const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const DATA_FILE = path.join(__dirname, "data.json");
const DEFAULT_TTL_DAYS = 30;
const ADMIN_KEY = process.env.TRANSCRIPT_ADMIN_KEY || process.env.ADMIN_KEY || "owner-1289658955919917157-proton-panel";

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

function loadData() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!data.records) data.records = {};
    if (!data.settings) data.settings = { ttlDays: DEFAULT_TTL_DAYS };
    if (typeof data.settings.ttlDays !== "number") data.settings.ttlDays = DEFAULT_TTL_DAYS;
    return data;
  } catch {
    return { records: {}, settings: { ttlDays: DEFAULT_TTL_DAYS } };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function cleanupExpired(data) {
  const ttlDays = Number(data.settings?.ttlDays ?? DEFAULT_TTL_DAYS);
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) return 0;
  const maxAgeMs = ttlDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let removed = 0;
  for (const [id, record] of Object.entries(data.records || {})) {
    const created = Date.parse(record.createdAt || "");
    if (Number.isFinite(created) && now - created > maxAgeMs) {
      delete data.records[id];
      removed++;
    }
  }
  if (removed) saveData(data);
  return removed;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function baseUrl(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

function adminKeyFrom(req) {
  return String(req.query.key || req.body.key || req.get("x-admin-key") || "");
}

function isAdmin(req) {
  return ADMIN_KEY && adminKeyFrom(req) === ADMIN_KEY;
}

function brDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function expiresAt(createdAt, ttlDays) {
  if (!ttlDays || ttlDays <= 0) return "Nunca";
  const created = Date.parse(createdAt || "");
  if (!Number.isFinite(created)) return "-";
  return brDate(new Date(created + ttlDays * 24 * 60 * 60 * 1000).toISOString());
}

function normalizeTheme(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["branco", "white", "claro", "light"].includes(raw)) return "branco";
  return "roxo";
}

function themeVars(theme) {
  if (normalizeTheme(theme) === "branco") {
    return `:root { color-scheme: light; --bg:#f7f7fb; --panel:#ffffff; --panel2:#f1f2f6; --text:#111827; --muted:#4b5563; --line:#d8dce7; --purple:#111827; --purple2:#374151; --green:#15803d; --red:#dc2626; }
    body { background: radial-gradient(circle at top left, rgba(17,24,39,.08), transparent 30%), linear-gradient(135deg, #ffffff, #f4f5fa 56%, #eceff5); }
    .logo { background:linear-gradient(135deg, #111827, #4b5563); color:#fff; box-shadow:0 12px 40px rgba(17,24,39,.16); }
    .status { color:#111827; background:rgba(17,24,39,.07); border-color:rgba(17,24,39,.18); }
    .hero,.viewer,.panel { background:rgba(255,255,255,.92); box-shadow:0 24px 80px rgba(17,24,39,.13); }
    .card { background:rgba(241,242,246,.78); }
    .viewer-head { background:rgba(241,242,246,.88); }
    .btn, button { color:#111827; border-color:rgba(17,24,39,.25); background:rgba(17,24,39,.06); }
    code,input { background:#ffffff; color:#111827; }`;
  }
  return `:root { color-scheme: dark; --bg:#0b0414; --panel:#170825; --panel2:#220d36; --text:#f8efff; --muted:#c7b4d8; --line:#4c1d72; --purple:#a855f7; --purple2:#7c3aed; --green:#22c55e; --red:#ef4444; }
    body { background: radial-gradient(circle at top left, rgba(168,85,247,.24), transparent 30%), radial-gradient(circle at bottom right, rgba(124,58,237,.16), transparent 34%), linear-gradient(135deg, #0b0414, #170825 56%, #090312); }`;
}

function layout(title, content, theme = "roxo") {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${escapeHtml(title)}</title>
  <style>
    ${themeVars(theme)}
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; color:var(--text); font-family: Inter, Arial, Helvetica, sans-serif; }
    .wrap { width:min(1180px, calc(100% - 28px)); margin:0 auto; padding:28px 0; }
    .top { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:22px; }
    .brand { display:flex; align-items:center; gap:12px; font-weight:900; letter-spacing:.3px; }
    .logo { width:42px; height:42px; border-radius:15px; display:grid; place-items:center; background:linear-gradient(135deg, var(--purple), var(--purple2)); color:#fff; box-shadow:0 12px 40px rgba(0,0,0,.22); }
    .status { color:var(--purple); background:color-mix(in srgb, var(--purple) 12%, transparent); border:1px solid color-mix(in srgb, var(--purple) 30%, transparent); padding:8px 11px; border-radius:999px; font-size:13px; font-weight:800; }
    .hero,.viewer,.panel { border:1px solid var(--line); background:color-mix(in srgb, var(--panel) 86%, transparent); backdrop-filter: blur(12px); border-radius:24px; padding:28px; box-shadow:0 24px 80px rgba(0,0,0,.35); }
    h1 { margin:0 0 10px; font-size:clamp(30px, 5vw, 54px); line-height:1; }
    h2 { margin:0 0 14px; }
    p { color:var(--muted); line-height:1.6; }
    .grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; margin-top:18px; }
    .card { border:1px solid var(--line); background:color-mix(in srgb, var(--panel2) 72%, transparent); border-radius:18px; padding:18px; }
    .card b { display:block; margin-bottom:6px; }
    .viewer { padding:0; overflow:hidden; }
    .viewer-head { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:18px 20px; border-bottom:1px solid var(--line); background:color-mix(in srgb, var(--panel2) 78%, transparent); }
    .viewer-title { min-width:0; }
    .viewer-title strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .viewer-title span { display:block; color:var(--muted); font-size:13px; margin-top:3px; }
    .btn, button { color:var(--text); text-decoration:none; border:1px solid color-mix(in srgb, var(--purple) 45%, transparent); padding:9px 12px; border-radius:12px; font-weight:800; font-size:13px; background:color-mix(in srgb, var(--purple) 14%, transparent); cursor:pointer; }
    .btn.danger, button.danger { border-color:rgba(239,68,68,.45); background:rgba(239,68,68,.12); }
    iframe { width:100%; height:calc(100vh - 146px); min-height:620px; border:0; background:#fff; display:block; }
    code { color:#e9d5ff; background:#090312; border:1px solid var(--line); padding:3px 6px; border-radius:8px; }
    table { width:100%; border-collapse:collapse; overflow:hidden; border-radius:16px; }
    th,td { text-align:left; padding:12px 10px; border-bottom:1px solid var(--line); color:var(--muted); vertical-align:middle; }
    th { color:var(--text); font-size:13px; }
    .actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
    .settings { display:flex; gap:10px; flex-wrap:wrap; align-items:end; margin:18px 0 22px; }
    label { display:grid; gap:7px; color:var(--muted); font-weight:700; }
    input { background:#090312; border:1px solid var(--line); color:var(--text); padding:10px 12px; border-radius:12px; min-width:170px; }
    .empty { padding:22px; border:1px dashed var(--line); border-radius:18px; color:var(--muted); }
    @media(max-width:760px){ .top{align-items:flex-start; flex-direction:column}.grid{grid-template-columns:1fr}.hero,.panel{padding:20px}.viewer-head{align-items:flex-start; flex-direction:column} iframe{min-height:70vh;height:75vh} table, thead, tbody, th, td, tr { display:block; } th{display:none} td{padding:9px 0}.actions{margin-top:8px} }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="brand"><div class="logo">PT</div><div>Proton Tickets</div></div>
      <div class="status">Online</div>
    </div>
    ${content}
  </div>
</body>
</html>`;
}

app.get("/", (req, res) => {
  res.send(layout("Proton Tickets", `
    <section class="hero">
      <h1>Central de registros</h1>
      <p>Ambiente online para guardar e consultar atendimentos finalizados com visual limpo, privado e direto.</p>
      <div class="grid">
        <div class="card"><b>Envio automático</b><p>O sistema envia o arquivo finalizado para a API.</p></div>
        <div class="card"><b>Link próprio</b><p>Cada registro recebe uma URL individual para consulta.</p></div>
        <div class="card"><b>Painel reservado</b><p>O painel administrativo usa chave privada no link.</p></div>
      </div>
    </section>
  `));
});

app.post("/api/transcripts", (req, res) => {
  const html = req.body.html || req.body.content || req.body.transcript;
  if (!html || typeof html !== "string") {
    return res.status(400).json({ ok:false, error:"Envie o HTML em body.html" });
  }

  const id = crypto.randomBytes(10).toString("hex");
  const data = loadData();
  cleanupExpired(data);
  data.records[id] = {
    html,
    filename: String(req.body.filename || "registro.html"),
    guildId: String(req.body.guildId || req.body.guild_id || ""),
    theme: normalizeTheme(req.body.theme || req.body.color || req.body.primaryColor),
    createdAt: new Date().toISOString()
  };
  saveData(data);

  res.json({ ok:true, id, url:`${baseUrl(req)}/t/${id}` });
});

app.get("/admin", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).send(layout("Acesso restrito", `
      <section class="hero">
        <h1>Acesso restrito</h1>
        <p>O painel exige uma chave válida.</p>
      </section>
    `));
  }

  const data = loadData();
  cleanupExpired(data);
  const ttlDays = Number(data.settings.ttlDays ?? DEFAULT_TTL_DAYS);
  const records = Object.entries(data.records || {}).sort((a, b) => Date.parse(b[1].createdAt || "") - Date.parse(a[1].createdAt || ""));
  const rows = records.map(([id, record]) => `
    <tr>
      <td><code>${escapeHtml(id)}</code></td>
      <td>${escapeHtml(record.filename || "registro.html")}</td>
      <td>${escapeHtml(normalizeTheme(record.theme) === "branco" ? "Branco" : "Roxo")}</td>
      <td>${escapeHtml(brDate(record.createdAt))}</td>
      <td>${escapeHtml(expiresAt(record.createdAt, ttlDays))}</td>
      <td>
        <div class="actions">
          <a class="btn" href="/t/${escapeHtml(id)}" target="_blank">Abrir</a>
          <form method="post" action="/admin/delete" onsubmit="return confirm('Apagar este registro?')">
            <input type="hidden" name="key" value="${escapeHtml(adminKeyFrom(req))}">
            <input type="hidden" name="id" value="${escapeHtml(id)}">
            <button class="danger" type="submit">Apagar</button>
          </form>
        </div>
      </td>
    </tr>
  `).join("");

  res.send(layout("Painel de registros", `
    <section class="panel">
      <h1>Painel de registros</h1>
      <p>Total salvo: <b>${records.length}</b>. Ajuste o tempo de retenção e consulte os registros quando precisar.</p>
      <form class="settings" method="post" action="/admin/settings">
        <input type="hidden" name="key" value="${escapeHtml(adminKeyFrom(req))}">
        <label>Dias para apagar automaticamente
          <input type="number" name="ttlDays" min="0" max="3650" value="${escapeHtml(ttlDays)}">
        </label>
        <button type="submit">Salvar configuração</button>
        <a class="btn" href="/admin/cleanup?key=${encodeURIComponent(adminKeyFrom(req))}">Limpar expirados</a>
      </form>
      ${records.length ? `<table><thead><tr><th>ID</th><th>Arquivo</th><th>Cor</th><th>Criado</th><th>Expira</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">Nenhum registro salvo ainda.</div>`}
    </section>
  `));
});

app.post("/admin/settings", (req, res) => {
  if (!isAdmin(req)) return res.status(403).send("Acesso negado.");
  const data = loadData();
  const ttlDays = Math.max(0, Math.min(3650, Number(req.body.ttlDays || DEFAULT_TTL_DAYS)));
  data.settings.ttlDays = Number.isFinite(ttlDays) ? ttlDays : DEFAULT_TTL_DAYS;
  saveData(data);
  res.redirect(`/admin?key=${encodeURIComponent(adminKeyFrom(req))}`);
});

app.post("/admin/delete", (req, res) => {
  if (!isAdmin(req)) return res.status(403).send("Acesso negado.");
  const data = loadData();
  const id = String(req.body.id || "");
  if (id && data.records[id]) {
    delete data.records[id];
    saveData(data);
  }
  res.redirect(`/admin?key=${encodeURIComponent(adminKeyFrom(req))}`);
});

app.get("/admin/cleanup", (req, res) => {
  if (!isAdmin(req)) return res.status(403).send("Acesso negado.");
  const data = loadData();
  cleanupExpired(data);
  res.redirect(`/admin?key=${encodeURIComponent(adminKeyFrom(req))}`);
});

app.get("/t/:id", (req, res) => {
  const data = loadData();
  cleanupExpired(data);
  const record = data.records[req.params.id];
  if (!record) {
    return res.status(404).send(layout("Registro não encontrado", `
      <section class="hero">
        <h1>Registro não encontrado</h1>
        <p>O link pode estar incorreto ou o registro pode ter expirado.</p>
      </section>
    `));
  }

  const date = brDate(record.createdAt);
  res.send(layout("Registro de atendimento", `
    <section class="viewer">
      <div class="viewer-head">
        <div class="viewer-title">
          <strong>Registro de atendimento</strong>
          <span>ID ${escapeHtml(req.params.id)} • ${escapeHtml(date)}</span>
        </div>
        <a class="btn" href="/raw/${escapeHtml(req.params.id)}" target="_blank">Abrir em tela cheia</a>
      </div>
      <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="${escapeAttr(record.html)}"></iframe>
    </section>
  `, record.theme));
});

app.get("/raw/:id", (req, res) => {
  const data = loadData();
  cleanupExpired(data);
  const record = data.records[req.params.id];
  if (!record) return res.status(404).send("Registro não encontrado.");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(record.html);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Proton Tickets online na porta ${port}`));
