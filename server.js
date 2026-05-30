const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const transcripts = new Map();

function escapeAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function page(title, body) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin:0; background:#0b0f19; color:#e5e7eb; font-family:Arial,sans-serif; }
    header { padding:18px 22px; background:#111827; border-bottom:1px solid #243041; }
    main { max-width:1100px; margin:0 auto; padding:22px; }
    .card { background:#111827; border:1px solid #243041; border-radius:14px; padding:18px; }
    a { color:#60a5fa; }
    iframe { width:100%; min-height:80vh; border:0; background:white; border-radius:10px; }
    code { background:#020617; padding:3px 6px; border-radius:6px; }
  </style>
</head>
<body>
<header><b>Proton Tickets</b></header>
<main>${body}</main>
</body>
</html>`;
}

app.get("/", (req, res) => {
  res.send(page("Proton Tickets", `
    <div class="card">
      <h1>Proton Tickets</h1>
      <p>Servidor online para hospedar transcripts HTML do bot de vendas.</p>
      <p>Use <code>POST /api/transcripts</code> para criar um transcript.</p>
    </div>
  `));
});

app.post("/api/transcripts", (req, res) => {
  const html = req.body.html || req.body.content || req.body.transcript;

  if (!html || typeof html !== "string") {
    return res.status(400).json({ ok: false, error: "Envie o HTML em body.html" });
  }

  const id = crypto.randomBytes(8).toString("hex");
  transcripts.set(id, {
    html,
    createdAt: new Date().toISOString()
  });

  const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  res.json({ ok: true, id, url: `${baseUrl}/t/${id}` });
});

app.get("/t/:id", (req, res) => {
  const item = transcripts.get(req.params.id);

  if (!item) {
    return res.status(404).send(page("Transcript não encontrado", `
      <div class="card">
        <h1>Transcript não encontrado</h1>
        <p>Esse transcript não existe ou o servidor foi reiniciado.</p>
      </div>
    `));
  }

  res.send(page(`Transcript ${req.params.id}`, `
    <div class="card">
      <h1>Transcript</h1>
      <p>Criado em: ${item.createdAt}</p>
      <iframe srcdoc="${escapeAttr(item.html)}"></iframe>
    </div>
  `));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Proton Tickets rodando na porta ${port}`));
