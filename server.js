const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_FILE = path.join(__dirname, 'data.json');
const DEFAULT_TTL_DAYS = 30;
const ADMIN_KEY = process.env.TRANSCRIPT_ADMIN_KEY || process.env.ADMIN_KEY || 'owner-1289658955919917157-proton-panel';

app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

function loadData(){
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    data.records ||= {};
    data.settings ||= { ttlDays: DEFAULT_TTL_DAYS };
    if (typeof data.settings.ttlDays !== 'number') data.settings.ttlDays = DEFAULT_TTL_DAYS;
    return data;
  } catch {
    return { records: {}, settings: { ttlDays: DEFAULT_TTL_DAYS } };
  }
}
function saveData(data){ fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
function cleanupExpired(data){
  const ttlDays = Number(data.settings?.ttlDays ?? DEFAULT_TTL_DAYS);
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) return;
  const limit = ttlDays * 86400000;
  const now = Date.now();
  let changed = false;
  for (const [id, record] of Object.entries(data.records || {})) {
    const created = Date.parse(record.createdAt || '');
    if (Number.isFinite(created) && now - created > limit) {
      delete data.records[id];
      changed = true;
    }
  }
  if (changed) saveData(data);
}
function esc(v){ return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function attr(v){ return esc(v).replaceAll('`','&#096;'); }
function decode(v){ return String(v || '').replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#039;',"'"); }
function baseUrl(req){ return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, ''); }
function adminKeyFrom(req){ return String(req.query.key || req.body.key || req.get('x-admin-key') || ''); }
function isAdmin(req){ return Boolean(ADMIN_KEY && adminKeyFrom(req) === ADMIN_KEY); }
function brDate(value){
  const d = new Date(value || '');
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', dateStyle:'short', timeStyle:'short' });
}
function expiresAt(createdAt, ttlDays){
  if (!ttlDays || ttlDays <= 0) return 'Nunca';
  const t = Date.parse(createdAt || '');
  return Number.isFinite(t) ? brDate(new Date(t + ttlDays*86400000).toISOString()) : '-';
}
function normalizeTheme(v){ return ['branco','white','claro','light'].includes(String(v || '').toLowerCase()) ? 'branco' : 'roxo'; }
function first(html, regex){ const m = String(html || '').match(regex); return m ? decode(m[1]) : ''; }
function safeUrl(v){
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.startsWith('data:image/')) return s;
  try { const u = new URL(s); return ['http:','https:'].includes(u.protocol) ? s : ''; } catch { return ''; }
}
function extractProfiles(html){
  const m = String(html || '').match(/window\.\$discordMessage\s*=\s*\{\s*profiles\s*:\s*(\{[\s\S]*?\})\s*\}\s*<\/script>/i);
  if (!m) return [];
  try {
    const obj = JSON.parse(m[1]);
    return Object.entries(obj).map(([id,p]) => ({
      id,
      name: String(p?.author || ''),
      avatar: safeUrl(p?.avatar || ''),
      roleName: String(p?.roleName || ''),
      roleColor: String(p?.roleColor || ''),
      bot: Boolean(p?.bot)
    }));
  } catch { return []; }
}
function inferInfo(html){
  const profiles = extractProfiles(html);
  const guildName = first(html, /<discord-header\b[^>]*\bguild="([^"]*)"/i);
  const channelName = first(html, /<discord-header\b[^>]*\bchannel="([^"]*)"/i) || first(html, /<title>([^<]*)<\/title>/i);
  const countRaw = first(html, /Exported\s+(\d+)\s+messages?/i);
  const nonBots = profiles.filter(p => !p.bot);
  const staff = nonBots.find(p => /(staff|suporte|support|admin|moder|dono|owner|atendente)/i.test(p.roleName));
  const client = nonBots.find(p => p.id !== staff?.id) || nonBots[0];
  return {
    profiles,
    guildName,
    channelName,
    messageCount: countRaw ? Number(countRaw) : null,
    clientName: client?.name || '',
    staffName: staff?.name || profiles.find(p => p.bot)?.name || ''
  };
}

function shell(title, content, theme='roxo'){
  const light = normalizeTheme(theme) === 'branco';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>
  :root{color-scheme:${light?'light':'dark'};--bg1:${light?'#f7f7fb':'#050508'};--bg2:${light?'#fff':'#0a0710'};--bg3:${light?'#eceff5':'#13091c'};--surface:${light?'rgba(255,255,255,.9)':'rgba(18,12,28,.78)'};--surface2:${light?'rgba(246,246,250,.9)':'rgba(24,16,38,.7)'};--line:${light?'rgba(17,24,39,.14)':'rgba(146,109,255,.18)'};--soft:${light?'rgba(17,24,39,.07)':'rgba(255,255,255,.05)'};--text:${light?'#111827':'#f4efff'};--muted:${light?'#4b5563':'#c2b8d8'};--muted2:${light?'#6b7280':'#8f86a7'};--purple:${light?'#374151':'#b89fff'};--green:${light?'#15803d':'#86efac'}}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;color:var(--text);font-family:Inter,Arial,sans-serif;background:radial-gradient(circle at 15% 15%,${light?'rgba(17,24,39,.06)':'rgba(92,51,200,.2)'},transparent 24%),radial-gradient(circle at 85% 8%,${light?'rgba(55,65,81,.05)':'rgba(139,92,246,.14)'},transparent 22%),linear-gradient(135deg,var(--bg1),var(--bg2) 42%,var(--bg3));overflow-x:hidden}.page{width:min(1080px,calc(100% - 24px));margin:22px auto 56px}.brand{display:flex;align-items:center;gap:11px;margin:0 2px 16px;font-weight:900}.logo{width:38px;height:38px;border-radius:13px;display:grid;place-items:center;color:#fff;background:linear-gradient(145deg,#9b73ff,#5430be);box-shadow:0 9px 24px rgba(91,49,190,.25)}.brand small{display:block;color:var(--muted2);font-size:10px;letter-spacing:.7px;text-transform:uppercase;margin-top:2px}.glass{background:linear-gradient(180deg,var(--surface),color-mix(in srgb,var(--surface) 88%,transparent));border:1px solid var(--line);backdrop-filter:blur(18px) saturate(135%);box-shadow:0 24px 70px rgba(0,0,0,${light?'.12':'.35'})}.hero{padding:28px;border-radius:26px;animation:up .7s both}.hero-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.hero h1{margin:0;font-size:clamp(28px,5vw,39px);letter-spacing:-1px;line-height:1.03}.hero p{margin:12px 0 0;color:var(--muted);line-height:1.7;max-width:760px}.status{padding:10px 14px;border-radius:999px;background:rgba(22,61,35,.56);color:${light?'#166534':'#d4ffe0'};border:1px solid rgba(134,239,172,.18);font-size:12px;font-weight:800;white-space:nowrap}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}.btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 15px;border-radius:14px;border:1px solid var(--line);background:var(--surface2);color:var(--text);text-decoration:none;font-size:13px;font-weight:800;cursor:pointer}.btn.primary{color:#fff;background:linear-gradient(180deg,rgba(108,66,226,.94),rgba(67,35,129,.96))}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0}.card{min-height:102px;padding:18px;border-radius:22px}.label{display:block;color:var(--muted2);font-size:11px;text-transform:uppercase;letter-spacing:.9px;margin-bottom:8px}.value{font-weight:800;overflow-wrap:anywhere}.purple{color:var(--purple)}.green{color:var(--green)}.people{padding:18px 20px;border-radius:22px;margin:18px 0}.people-title{font-size:11px;color:var(--muted2);font-weight:800;text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px}.people-list{display:flex;gap:10px;flex-wrap:wrap}.person{display:flex;align-items:center;gap:9px;padding:8px 11px 8px 8px;border:1px solid var(--line);border-radius:15px;background:var(--surface2)}.person img,.fallback{width:34px;height:34px;border-radius:11px;object-fit:cover}.fallback{display:grid;place-items:center;background:linear-gradient(145deg,#8b5cf6,#4c1d95);color:#fff;font-weight:900}.person strong{display:block;font-size:12px;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.person span{display:block;color:var(--muted2);font-size:10px;margin-top:2px}.viewer{border-radius:26px;overflow:hidden}.viewer-head{display:flex;justify-content:space-between;align-items:center;padding:20px 22px;border-bottom:1px solid var(--soft)}.viewer-head strong{font-size:15px}.viewer-head span{font-size:12px;color:var(--muted)}iframe{display:block;width:100%;height:72vh;min-height:640px;border:0;background:${light?'#fff':'#0d0b12'}}footer{display:flex;justify-content:space-between;gap:16px;padding:18px 22px;border-top:1px solid var(--soft);color:var(--muted);font-size:12px}.panel{padding:26px;border-radius:26px}.panel h1{margin:0 0 8px}.panel p{color:var(--muted)}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid var(--soft);color:var(--muted)}th{color:var(--text);font-size:12px}.settings{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:18px 0}.settings label{display:grid;gap:7px;color:var(--muted);font-size:12px;font-weight:700}.settings input{background:var(--surface2);border:1px solid var(--line);color:var(--text);padding:11px 12px;border-radius:12px}.empty{padding:20px;border:1px dashed var(--line);border-radius:16px;color:var(--muted)}@keyframes up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}@media(max-width:900px){.grid{grid-template-columns:1fr 1fr}}@media(max-width:600px){.page{width:calc(100% - 14px);margin:14px auto 34px}.hero,.panel{padding:20px}.hero-top{flex-direction:column}.grid{grid-template-columns:1fr}.card{min-height:auto}.viewer-head{align-items:flex-start;flex-direction:column;gap:7px}footer{flex-direction:column}.btn{width:100%}table,thead,tbody,tr,th,td{display:block}th{display:none}td{padding:9px 0}}
  </style></head><body><main class="page"><div class="brand"><div class="logo">P</div><div>Proton System<small>Proton For Seller • Tickets</small></div></div>${content}</main></body></html>`;
}

function peopleCards(profiles){
  if (!profiles?.length) return '';
  const cards = profiles.slice(0,20).map(p => {
    const name = p.name || 'Usuário';
    const avatar = safeUrl(p.avatar);
    return `<div class="person">${avatar?`<img src="${attr(avatar)}" alt="Avatar de ${attr(name)}" loading="lazy">`:`<div class="fallback">${esc(name.slice(0,1).toUpperCase() || '?')}</div>`}<div><strong>${esc(name)}</strong><span>${esc(p.bot?'BOT':(p.roleName || 'Participante'))}</span></div></div>`;
  }).join('');
  return `<section class="people glass"><div class="people-title">Participantes registrados</div><div class="people-list">${cards}</div></section>`;
}
function transcriptPage(id, record){
  const info = inferInfo(record.html);
  const profiles = record.profiles?.length ? record.profiles : info.profiles;
  const ticket = record.ticketId || record.channelName || info.channelName || id;
  const guild = record.guildName || info.guildName || 'Servidor não informado';
  const client = record.clientName || info.clientName || 'Não informado';
  const staff = record.staffName || info.staffName || 'Não informado';
  const count = Number.isFinite(Number(record.messageCount)) ? Number(record.messageCount) : info.messageCount;
  const countLabel = Number.isFinite(count) ? `${count} ${count===1?'mensagem registrada':'mensagens registradas'}` : 'Histórico preservado';
  return shell(`Transcript ${ticket} • Proton For Seller`, `
  <section class="hero glass"><div class="hero-top"><div><h1>Transcript do Ticket ${esc(ticket.startsWith('#')?ticket:`#${ticket}`)}</h1><p>Esta página mostra o histórico final do atendimento após o encerramento do ticket. O conteúdo foi salvo automaticamente para consulta, auditoria e registro.</p></div><div class="status">● Ticket Fechado</div></div><div class="actions"><a class="btn primary" href="/raw/${attr(id)}" target="_blank">Abrir / Imprimir</a><button class="btn" onclick="navigator.clipboard.writeText(${JSON.stringify(ticket)})">Copiar ID do ticket</button></div></section>
  <section class="grid"><div class="card glass"><span class="label">Servidor</span><div class="value">${esc(guild)}</div></div><div class="card glass"><span class="label">Cliente</span><div class="value">${esc(client)}</div></div><div class="card glass"><span class="label">Atendente</span><div class="value purple">${esc(staff)}</div></div><div class="card glass"><span class="label">Encerrado em</span><div class="value green">${esc(brDate(record.closedAt || record.createdAt))}</div></div></section>
  ${peopleCards(profiles)}
  <section class="viewer glass"><div class="viewer-head"><strong>Histórico da conversa</strong><span>${esc(countLabel)}</span></div><iframe src="/raw/${attr(id)}" title="Histórico do ticket" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"></iframe><footer><span><strong>Proton For Seller</strong> • Transcript salvo com sucesso</span><span>Avatares, emojis e anexos preservados quando disponíveis.</span></footer></section>`, record.theme);
}

app.get('/', (req,res) => res.send(shell('Proton Tickets', `<section class="hero glass"><div class="hero-top"><div><h1>Central de transcripts</h1><p>Registros de atendimento do Proton For Seller, armazenados para consulta após o encerramento dos tickets.</p></div><div class="status">● Online</div></div></section>`)));

app.post('/api/transcripts', (req,res) => {
  const html = req.body.html || req.body.content || req.body.transcript;
  if (!html || typeof html !== 'string') return res.status(400).json({ok:false,error:'Envie o HTML em body.html'});
  const info = inferInfo(html);
  const id = crypto.randomBytes(10).toString('hex');
  const data = loadData();
  cleanupExpired(data);
  const supplied = Number(req.body.messageCount ?? req.body.message_count);
  data.records[id] = {
    html,
    filename: String(req.body.filename || 'registro.html'),
    guildId: String(req.body.guildId || req.body.guild_id || ''),
    guildName: String(req.body.guildName || req.body.guild_name || info.guildName || ''),
    channelName: String(req.body.channelName || req.body.channel_name || info.channelName || ''),
    ticketId: String(req.body.ticketId || req.body.ticket_id || req.body.channelId || req.body.channel_id || info.channelName || ''),
    clientName: String(req.body.clientName || req.body.client_name || req.body.customerName || req.body.userName || info.clientName || ''),
    staffName: String(req.body.staffName || req.body.staff_name || req.body.closedByTag || info.staffName || ''),
    closedAt: String(req.body.closedAt || req.body.closed_at || new Date().toISOString()),
    messageCount: Number.isFinite(supplied) && supplied >= 0 ? supplied : info.messageCount,
    profiles: info.profiles,
    theme: normalizeTheme(req.body.theme || req.body.color || req.body.primaryColor),
    createdAt: new Date().toISOString()
  };
  saveData(data);
  res.json({ok:true,id,url:`${baseUrl(req)}/t/${id}`,rawUrl:`${baseUrl(req)}/raw/${id}`});
});

app.get('/t/:id', (req,res) => {
  const data = loadData(); cleanupExpired(data);
  const record = data.records[req.params.id];
  if (!record) return res.status(404).send(shell('Transcript não encontrado', `<section class="hero glass"><h1>Transcript não encontrado</h1><p>O link pode estar incorreto ou o registro pode ter expirado.</p></section>`));
  res.send(transcriptPage(req.params.id, record));
});
app.get('/raw/:id', (req,res) => {
  const data = loadData(); cleanupExpired(data);
  const record = data.records[req.params.id];
  if (!record) return res.status(404).send('Registro não encontrado.');
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.send(record.html);
});
app.get('/admin', (req,res) => {
  if (!isAdmin(req)) return res.status(403).send(shell('Acesso restrito', `<section class="hero glass"><h1>Acesso restrito</h1><p>O painel exige uma chave válida.</p></section>`));
  const data = loadData(); cleanupExpired(data);
  const ttl = Number(data.settings.ttlDays ?? DEFAULT_TTL_DAYS);
  const records = Object.entries(data.records || {}).sort((a,b)=>Date.parse(b[1].createdAt||'')-Date.parse(a[1].createdAt||''));
  const rows = records.map(([id,r]) => { const i=inferInfo(r.html); const ticket=r.ticketId||r.channelName||i.channelName||id; return `<tr><td>${esc(ticket)}</td><td>${esc(r.guildName||i.guildName||'-')}</td><td>${esc(brDate(r.createdAt))}</td><td>${esc(expiresAt(r.createdAt,ttl))}</td><td><a class="btn" href="/t/${attr(id)}" target="_blank">Abrir</a></td></tr>`; }).join('');
  res.send(shell('Painel de transcripts', `<section class="panel glass"><h1>Painel de transcripts</h1><p>Total salvo: <strong>${records.length}</strong>.</p><form class="settings" method="post" action="/admin/settings"><input type="hidden" name="key" value="${attr(adminKeyFrom(req))}"><label>Dias para apagar automaticamente<input type="number" name="ttlDays" min="0" max="3650" value="${attr(ttl)}"></label><button class="btn primary" type="submit">Salvar</button></form>${records.length?`<table><thead><tr><th>Ticket</th><th>Servidor</th><th>Criado</th><th>Expira</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`:`<div class="empty">Nenhum transcript salvo ainda.</div>`}</section>`));
});
app.post('/admin/settings', (req,res) => {
  if (!isAdmin(req)) return res.status(403).send('Acesso negado.');
  const data = loadData();
  const ttl = Math.max(0, Math.min(3650, Number(req.body.ttlDays || DEFAULT_TTL_DAYS)));
  data.settings.ttlDays = Number.isFinite(ttl) ? ttl : DEFAULT_TTL_DAYS;
  saveData(data);
  res.redirect(`/admin?key=${encodeURIComponent(adminKeyFrom(req))}`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Proton Tickets online na porta ${port}`));
