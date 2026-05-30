const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const DATA_FILE = path.join(__dirname, "data.json");

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { records: {} };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
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

function layout(title, content) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; --bg:#050816; --panel:#0c1224; --panel2:#111a33; --text:#eef2ff; --muted:#94a3b8; --line:#1e2a44; --blue:#38bdf8; --green:#22c55e; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; background: radial-gradient(circle at top left, rgba(56,189,248,.16), transparent 28%), linear-gradient(135deg, #050816, #0b1020 58%, #020617); color:var(--text); font-family: Inter, Arial, Helvetica, sans-serif; }
    .wrap { width:min(1180px, calc(100% - 28px)); margin:0 auto; padding:28px 0; }
    .top { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:22px; }
    .brand { display:flex; align-items:center; gap:12px; font-weight:900; letter-spacing:.3px; }
    .logo { width:42px; height:42px; border-radius:15px; display:grid; place-items:center; background:linear-gradient(135deg, #38bdf8, #2563eb); color:#fff; box-shadow:0 12px 40px rgba(37,99,235,.35); }
    .status { color:#bbf7d0; background:rgba(34,197,94,.11); border:1px solid rgba(34,197,94,.24); padding:8px 11px; border-radius:999px; font-size:13px; font-weight:800; }
    .hero { border:1px solid var(--line); background:rgba(12,18,36,.82); backdrop-filter: blur(12px); border-radius:24px; padding:28px; box-shadow:0 24px 80px rgba(0,0,0,.35); }
    h1 { margin:0 0 10px; font-size:clamp(30px, 5vw, 54px); line-height:1; }
    p { color:var(--muted); line-height:1.6; }
    .grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; margin-top:18px; }
    .card { border:1px solid var(--line); background:rgba(17,26,51,.7); border-radius:18px; padding:18px; }
    .card b { display:block; margin-bottom:6px; }
    .viewer { border:1px solid var(--line); background:rgba(12,18,36,.86); border-radius:24px; overflow:hidden; box-shadow:0 24px 80px rgba(0,0,0,.35); }
    .viewer-head { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:18px 20px; border-bottom:1px solid var(--line); background:rgba(17,26,51,.76); }
    .viewer-title { min-width:0; }
    .viewer-title strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .viewer-title span { display:block; color:var(--muted); font-size:13px; margin-top:3px; }
    .btn { color:#e0f2fe; text-decoration:none; border:1px solid rgba(56,189,248,.35); padding:9px 12px; border-radius:12px; font-weight:800; font-size:13px; background:rgba(56,189,248,.1); }
    iframe { width:100%; height:calc(100vh - 146px); min-height:620px; border:0; background:#fff; display:block; }
    code { color:#bae6fd; background:#020617; border:1px solid var(--line); padding:3px 6px; border-radius:8px; }
    @media(max-width:760px){ .top{align-items:flex-start; flex-direction:column}.grid{grid-template-columns:1fr}.hero{padding:20px}.viewer-head{align-items:flex-start; flex-direction:column} iframe{min-height:70vh;height:75vh} }
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
        <div class="card"><b>Envio automático</b><p>O bot envia o HTML do atendimento para a API.</p></div>
        <div class="card"><b>Link público</b><p>Cada registro recebe uma URL própria para consulta.</p></div>
        <div class="card"><b>Leitura organizada</b><p>Layout preparado para celular e computador.</p></div>
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
  data.records[id] = {
    html,
    filename: String(req.body.filename || "registro.html"),
    createdAt: new Date().toISOString()
  };
  saveData(data);

  res.json({ ok:true, id, url:`${baseUrl(req)}/t/${id}` });
});

app.get("/t/:id", (req, res) => {
  const data = loadData();
  const record = data.records[req.params.id];
  if (!record) {
    return res.status(404).send(layout("Registro não encontrado", `
      <section class="hero">
        <h1>Registro não encontrado</h1>
        <p>O link pode estar incorreto ou o serviço pode ter sido reiniciado sem o arquivo salvo.</p>
      </section>
    `));
  }

  const date = new Date(record.createdAt).toLocaleString("pt-BR", { timeZone:"America/Sao_Paulo" });
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
  `));
});

app.get("/raw/:id", (req, res) => {
  const data = loadData();
  const record = data.records[req.params.id];
  if (!record) return res.status(404).send("Registro não encontrado.");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(record.html);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Proton Tickets online na porta ${port}`));
