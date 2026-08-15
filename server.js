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

function loadData() {
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

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function cleanupExpired(data) {
  const ttlDays = Number(data.settings?.ttlDays ?? DEFAULT_TTL_DAYS);
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) return 0;
  const limit = ttlDays * 86400000;
  const now = Date.now();
  let removed = 0;
  for (const [id, record] of Object.entries(data.records || {})) {
    const created = Date.parse(record.createdAt || '');
    if (Number.isFinite(created) && now - created > limit) {
      delete data.records[id];
      removed++;
    }
  }
  if (removed) saveData(data);
  return removed;
}

function esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function attr(v) { return esc(v).replaceAll('`', '&#096;'); }
function decode(v) {
  return String(v || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&#39;', "'");
}
function baseUrl(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}
function adminKeyFrom(req) {
  return String(req.query.key || req.body.key || req.get('x-admin-key') || '');
}
function isAdmin(req) { return Boolean(ADMIN_KEY && adminKeyFrom(req) === ADMIN_KEY); }
function brDate(value) {
  const d = new Date(value || '');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short'
  });
}
function expiresAt(createdAt, ttlDays) {
  if (!ttlDays || ttlDays <= 0) return 'Nunca';
  const t = Date.parse(createdAt || '');
  return Number.isFinite(t) ? brDate(new Date(t + ttlDays * 86400000).toISOString()) : '-';
}
function normalizeTheme(v) {
  return ['branco', 'white', 'claro', 'light'].includes(String(v || '').trim().toLowerCase()) ? 'branco' : 'roxo';
}
function first(html, regex) {
  const m = String(html || '').match(regex);
  return m ? decode(m[1]) : '';
}
function safeUrl(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.startsWith('data:image/')) return s;
  try {
    const u = new URL(s);
    return ['http:', 'https:'].includes(u.protocol) ? s : '';
  } catch {
    return '';
  }
}

function extractProfiles(html) {
  const source = String(html || '');
  const m = source.match(/window\.\$discordMessage\s*=\s*\{\s*profiles\s*:\s*(\{[\s\S]*?\})\s*\}\s*<\/script>/i);
  if (!m) return [];
  try {
    const obj = JSON.parse(m[1]);
    return Object.entries(obj).map(([id, p]) => ({
      id,
      name: String(p?.author || ''),
      avatar: safeUrl(p?.avatar || ''),
      roleName: String(p?.roleName || ''),
      roleColor: String(p?.roleColor || ''),
      bot: Boolean(p?.bot)
    }));
  } catch {
    return [];
  }
}

function cleanTicketName(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  raw = raw.replace(/^atendimento\s*[-–—:]\s*/i, '').trim();
  const ticketMatch = raw.match(/(ticket(?:-[\wÀ-ÿ.]+)+)/i);
  if (ticketMatch) raw = ticketMatch[1];
  return raw.replace(/^#+/, '');
}

function inferClientFromChannel(channel) {
  const raw = cleanTicketName(channel).toLowerCase();
  if (!raw) return '';

  const patterns = [
    /^ticket-suporte-(.+)$/i,
    /^ticket-support-(.+)$/i,
    /^ticket-atendimento-(.+)$/i,
    /^ticket-(.+)$/i,
    /^suporte-(.+)$/i,
    /^atendimento-(.+)$/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/[-_]+/g, ' ').trim();
    }
  }
  return '';
}

function extractAuthorNamesFromMessages(html) {
  const source = String(html || '');
  const names = [];
  const seen = new Set();

  for (const match of source.matchAll(/<discord-message\b[^>]*\bprofile="([^"]+)"[^>]*>/gi)) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      names.push(id);
    }
  }
  return names;
}

function inferInfo(html) {
  const source = String(html || '');
  const profiles = extractProfiles(source);

  const guildName =
    first(source, /<discord-header\b[^>]*\bguild="([^"]*)"/i) ||
    first(source, /<meta\b[^>]*\bname="guild"[^>]*\bcontent="([^"]*)"/i) ||
    first(source, /data-guild-name="([^"]*)"/i);

  const title = first(source, /<title>([^<]*)<\/title>/i);
  const headerChannel = first(source, /<discord-header\b[^>]*\bchannel="([^"]*)"/i);
  const channelName = cleanTicketName(headerChannel || title);

  const countRaw = first(source, /Exported\s+(\d+)\s+messages?/i) || first(source, /Total\s+de\s+mensagens\s*:\s*(\d+)/i);
  const nonBots = profiles.filter(p => !p.bot);
  const staff = nonBots.find(p => /(staff|suporte|support|admin|moder|dono|owner|atendente|equipe)/i.test(p.roleName));
  const client = nonBots.find(p => p.id !== staff?.id) || nonBots[0];

  let clientName = client?.name || '';
  if (!clientName) clientName = inferClientFromChannel(channelName || title);

  let staffName = staff?.name || '';
  if (!staffName) {
    const likelyStaffBot = profiles.find(p => p.bot && /(proton|support|suporte|ticket)/i.test(p.name));
    if (likelyStaffBot) staffName = '';
  }

  return {
    profiles,
    guildName: String(guildName || '').trim(),
    channelName,
    messageCount: countRaw ? Number(countRaw) : null,
    clientName: String(clientName || '').trim(),
    staffName: String(staffName || '').trim(),
    profileIds: extractAuthorNamesFromMessages(source)
  };
}

function styleRawTranscript(html, theme = 'roxo') {
  const light = normalizeTheme(theme) === 'branco';
  const css = light ? `
    html,body{background:#f7f7f9!important}
  ` : `
    :root{
      --background-primary:#09070d!important;
      --background-secondary:#0d0913!important;
      --background-secondary-alt:#100b17!important;
      --background-tertiary:#08060b!important;
      --background-floating:#100b17!important;
      --channeltextarea-background:#120c1a!important;
    }
    html,body{background:#09070d!important;color:#f4effa!important}
    discord-messages{background:#09070d!important}
    discord-header{background:#0d0913!important;border-color:rgba(155,110,255,.14)!important}
    [class*="sidebar"],[class*="Sidebar"],[class*="side-panel"],[class*="left-panel"]{
      background:#0d0913!important;
      border-color:rgba(155,110,255,.14)!important;
    }
    [class*="content"],[class*="Content"],[class*="messages"],[class*="Messages"],[class*="transcript"],[class*="Transcript"]{
      background-color:#09070d!important;
    }
    [class*="card"],[class*="Card"],[class*="message-box"],[class*="message-content"]{
      background-color:rgba(18,12,26,.88)!important;
      border-color:rgba(155,110,255,.13)!important;
    }
    ::-webkit-scrollbar-track{background:#09070d!important}
    ::-webkit-scrollbar-thumb{background:#3b2a50!important;border-radius:12px!important}
  `;

  const style = `<style id="proton-transcript-polish">${css}</style>`;
  const source = String(html || '');
  if (/<\/head>/i.test(source)) return source.replace(/<\/head>/i, `${style}</head>`);
  return `${style}${source}`;
}

function shell(title, content, theme = 'roxo') {
  const light = normalizeTheme(theme) === 'branco';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
:root{
  color-scheme:${light ? 'light' : 'dark'};
  --bg:${light ? '#f6f6f8' : '#07050b'};
  --bg2:${light ? '#ffffff' : '#0d0913'};
  --surface:${light ? 'rgba(255,255,255,.94)' : 'rgba(17,11,25,.88)'};
  --surface2:${light ? 'rgba(245,245,248,.95)' : 'rgba(25,16,37,.72)'};
  --line:${light ? 'rgba(20,20,30,.10)' : 'rgba(155,110,255,.16)'};
  --soft:${light ? 'rgba(20,20,30,.06)' : 'rgba(255,255,255,.055)'};
  --text:${light ? '#15131a' : '#f5f1fa'};
  --muted:${light ? '#66616d' : '#aaa0b8'};
  --muted2:${light ? '#85808b' : '#7d738b'};
  --purple:${light ? '#5e35b1' : '#b697ff'};
  --purpleStrong:#7c4dff;
  --green:${light ? '#16834c' : '#73e8a6'};
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0;min-height:100vh;color:var(--text);
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  background:
    radial-gradient(circle at 9% -5%,${light ? 'rgba(94,53,177,.08)' : 'rgba(124,77,255,.15)'},transparent 28%),
    radial-gradient(circle at 100% 18%,${light ? 'rgba(94,53,177,.05)' : 'rgba(120,57,210,.08)'},transparent 25%),
    linear-gradient(180deg,var(--bg),var(--bg2));
  overflow-x:hidden;
}
.page{width:min(1040px,calc(100% - 28px));margin:24px auto 52px}
.glass{
  background:linear-gradient(180deg,var(--surface),color-mix(in srgb,var(--surface) 92%,transparent));
  border:1px solid var(--line);
  box-shadow:0 18px 60px rgba(0,0,0,${light ? '.08' : '.28'});
  backdrop-filter:blur(16px) saturate(120%);
  -webkit-backdrop-filter:blur(16px) saturate(120%);
}
.hero{border-radius:24px;padding:26px;animation:fadeUp .5s ease both}
.hero-main{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
.hero-copy{min-width:0;flex:1}
.eyebrow{display:block;margin-bottom:10px;color:var(--purple);font-size:11px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}
.hero h1{margin:0;font-size:clamp(27px,4.6vw,40px);line-height:1.08;letter-spacing:-1.2px;overflow-wrap:anywhere}
.hero p{max-width:700px;margin:11px 0 0;color:var(--muted);font-size:14px;line-height:1.62}
.status{flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;padding:9px 12px;border-radius:999px;background:rgba(24,105,62,.18);border:1px solid rgba(92,220,142,.17);color:var(--green);font-size:11px;font-weight:850;white-space:nowrap}
.status-dot{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px color-mix(in srgb,currentColor 9%,transparent)}
.actions{display:grid;grid-template-columns:auto auto;justify-content:start;gap:10px;margin-top:19px}
.btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:10px 14px;border-radius:13px;border:1px solid var(--line);background:var(--surface2);color:var(--text);text-decoration:none;font-size:12px;font-weight:820;cursor:pointer;transition:.18s ease}
.btn:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--purpleStrong) 34%,var(--line))}
.btn.primary{border-color:rgba(157,117,255,.24);background:linear-gradient(180deg,#7748e8,#542aa8);color:#fff;box-shadow:0 8px 24px rgba(82,42,167,.23)}
.summary{margin:14px 0;padding:3px 20px;border-radius:21px}
.summary-row{display:grid;grid-template-columns:150px minmax(0,1fr);gap:14px;align-items:center;min-height:56px;padding:10px 0;border-bottom:1px solid var(--soft)}
.summary-row:last-child{border-bottom:0}
.summary-label{color:var(--muted2);font-size:10px;font-weight:820;letter-spacing:.10em;text-transform:uppercase}
.summary-value{min-width:0;color:var(--text);font-size:13px;font-weight:760;overflow-wrap:anywhere}
.summary-value.purple{color:var(--purple)}
.summary-value.green{color:var(--green)}
.people{padding:16px 18px;border-radius:21px;margin:14px 0}
.people-title{margin-bottom:11px;color:var(--muted2);font-size:10px;font-weight:820;letter-spacing:.10em;text-transform:uppercase}
.people-list{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;scrollbar-width:thin}
.person{flex:0 0 auto;display:flex;align-items:center;gap:8px;max-width:230px;padding:7px 10px 7px 7px;border:1px solid var(--line);border-radius:14px;background:var(--surface2)}
.person img,.fallback{width:32px;height:32px;border-radius:10px;object-fit:cover}
.fallback{display:grid;place-items:center;background:linear-gradient(145deg,#8b5cf6,#4c1d95);color:#fff;font-size:12px;font-weight:900}
.person strong{display:block;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
.person span{display:block;margin-top:1px;color:var(--muted2);font-size:9px}
.viewer{border-radius:22px;overflow:hidden;background:${light ? '#fff' : '#09070d'}}
.viewer-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--soft);background:${light ? 'rgba(255,255,255,.72)' : 'rgba(10,7,14,.92)'}}
.viewer-head strong{font-size:13px}.viewer-head span{color:var(--muted);font-size:10px}
iframe{display:block;width:100%;height:72vh;min-height:620px;border:0;background:${light ? '#fff' : '#09070d'}}
footer{display:flex;justify-content:space-between;gap:14px;padding:14px 18px;border-top:1px solid var(--soft);color:var(--muted2);font-size:10px;line-height:1.5}
.panel{padding:24px;border-radius:22px}.panel h1{margin:0 0 8px}.panel p{color:var(--muted)}
table{width:100%;border-collapse:collapse;margin-top:16px}th,td{text-align:left;padding:11px 9px;border-bottom:1px solid var(--soft);color:var(--muted);font-size:12px}th{color:var(--text);font-size:10px}.settings{display:flex;gap:9px;align-items:end;flex-wrap:wrap;margin:16px 0}.settings label{display:grid;gap:6px;color:var(--muted);font-size:11px;font-weight:700}.settings input{background:var(--surface2);border:1px solid var(--line);color:var(--text);padding:10px 11px;border-radius:11px}.empty{padding:18px;border:1px dashed var(--line);border-radius:14px;color:var(--muted)}
@keyframes fadeUp{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}
@media(max-width:620px){
  .page{width:calc(100% - 16px);margin:8px auto 24px}
  .hero{padding:18px;border-radius:19px}
  .hero-main{display:block}
  .eyebrow{margin-bottom:8px;font-size:9px}
  .hero h1{font-size:25px;line-height:1.12;letter-spacing:-.7px}
  .hero p{margin-top:9px;font-size:12px;line-height:1.52}
  .status{margin-top:14px;padding:8px 10px;font-size:10px}
  .actions{grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}
  .btn{width:100%;min-height:39px;padding:9px 10px;border-radius:12px;font-size:10px}
  .summary{margin:10px 0;padding:2px 14px;border-radius:17px}
  .summary-row{grid-template-columns:92px minmax(0,1fr);gap:9px;min-height:47px;padding:8px 0}
  .summary-label{font-size:8px;letter-spacing:.08em}
  .summary-value{font-size:11px}
  .people{margin:10px 0;padding:12px;border-radius:17px}
  .people-title{font-size:8px;margin-bottom:8px}
  .person{padding:6px 8px 6px 6px;border-radius:12px}
  .person img,.fallback{width:28px;height:28px;border-radius:9px}
  .person strong{font-size:10px;max-width:130px}.person span{font-size:8px}
  .viewer{border-radius:18px}
  .viewer-head{padding:12px 13px}.viewer-head strong{font-size:11px}.viewer-head span{font-size:9px}
  iframe{height:76vh;min-height:560px}
  footer{display:block;padding:12px 13px;font-size:9px}footer span+span{display:block;margin-top:4px}
  table,thead,tbody,tr,th,td{display:block}th{display:none}td{padding:8px 0}
}
</style>
</head>
<body><main class="page">${content}</main></body></html>`;
}

function peopleCards(profiles) {
  if (!Array.isArray(profiles) || !profiles.length) return '';
  const cards = profiles.slice(0, 20).map(p => {
    const name = p.name || 'Usuário';
    const avatar = safeUrl(p.avatar);
    const role = p.bot ? 'BOT' : (p.roleName || 'Participante');
    return `<div class="person">
      ${avatar ? `<img src="${attr(avatar)}" alt="Avatar de ${attr(name)}" loading="lazy" referrerpolicy="no-referrer">` : `<div class="fallback">${esc(name.slice(0, 1).toUpperCase() || '?')}</div>`}
      <div><strong>${esc(name)}</strong><span>${esc(role)}</span></div>
    </div>`;
  }).join('');
  return `<section class="people glass"><div class="people-title">Participantes</div><div class="people-list">${cards}</div></section>`;
}

function infoRow(label, value, cls = '') {
  const clean = String(value || '').trim();
  if (!clean) return '';
  return `<div class="summary-row"><div class="summary-label">${esc(label)}</div><div class="summary-value ${cls}">${esc(clean)}</div></div>`;
}

function transcriptPage(id, record) {
  const info = inferInfo(record.html);
  const profiles = Array.isArray(record.profiles) && record.profiles.length ? record.profiles : info.profiles;
  const ticket = cleanTicketName(record.ticketId || record.channelName || info.channelName || id) || id;
  const guild = String(record.guildName || info.guildName || '').trim();
  const client = String(record.clientName || info.clientName || inferClientFromChannel(ticket) || '').trim();
  const staff = String(record.staffName || info.staffName || '').trim();
  const closed = brDate(record.closedAt || record.createdAt);
  const count = Number.isFinite(Number(record.messageCount)) ? Number(record.messageCount) : info.messageCount;
  const countLabel = Number.isFinite(count) ? `${count} ${count === 1 ? 'mensagem' : 'mensagens'}` : 'Histórico completo';

  const rows = [
    infoRow('Servidor', guild),
    infoRow('Cliente', client),
    infoRow('Atendente', staff, 'purple'),
    infoRow('Encerrado em', closed, 'green')
  ].filter(Boolean).join('');

  const summary = rows ? `<section class="summary glass">${rows}</section>` : '';

  return shell(`Transcript ${ticket} • Proton For Seller`, `
    <section class="hero glass">
      <div class="hero-main">
        <div class="hero-copy">
          <span class="eyebrow">Transcript de atendimento</span>
          <h1>#${esc(ticket)}</h1>
          <p>Histórico final do ticket após o encerramento. Mensagens, avatares, emojis e anexos permanecem no registro quando disponíveis.</p>
        </div>
        <div class="status"><span class="status-dot"></span>Ticket fechado</div>
      </div>
      <div class="actions">
        <a class="btn primary" href="/raw/${attr(id)}" target="_blank" rel="noopener">Abrir / Imprimir</a>
        <button class="btn" id="copy-ticket-id" type="button">Copiar ID</button>
      </div>
    </section>
    ${summary}
    ${peopleCards(profiles)}
    <section class="viewer glass">
      <div class="viewer-head"><strong>Histórico da conversa</strong><span>${esc(countLabel)}</span></div>
      <iframe src="/raw/${attr(id)}" title="Histórico do ticket" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"></iframe>
      <footer><span>Proton For Seller • Transcript salvo automaticamente</span><span>Conteúdo preservado do atendimento original.</span></footer>
    </section>
    <script>
      (() => {
        const button = document.getElementById('copy-ticket-id');
        if (!button) return;
        const ticketId = ${JSON.stringify(ticket).replace(/</g, '\\u003c')};
        button.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(ticketId);
            const original = button.textContent;
            button.textContent = 'ID copiado';
            setTimeout(() => { button.textContent = original; }, 1400);
          } catch {}
        });
      })();
    </script>
  `, record.theme);
}

app.get('/', (req, res) => {
  res.send(shell('Proton Tickets', `
    <section class="hero glass">
      <div class="hero-main"><div class="hero-copy"><span class="eyebrow">Proton For Seller</span><h1>Central de transcripts</h1><p>Registros de atendimento armazenados após o encerramento dos tickets.</p></div><div class="status"><span class="status-dot"></span>Online</div></div>
    </section>
  `));
});

app.post('/api/transcripts', (req, res) => {
  const html = req.body.html || req.body.content || req.body.transcript;
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ ok: false, error: 'Envie o HTML em body.html' });
  }

  const info = inferInfo(html);
  const id = crypto.randomBytes(10).toString('hex');
  const data = loadData();
  cleanupExpired(data);

  const supplied = Number(req.body.messageCount ?? req.body.message_count);
  const rawChannel = String(req.body.channelName || req.body.channel_name || info.channelName || '');
  const ticketId = cleanTicketName(req.body.ticketId || req.body.ticket_id || req.body.channelId || req.body.channel_id || rawChannel || info.channelName);
  const inferredClient = inferClientFromChannel(ticketId || rawChannel);

  data.records[id] = {
    html,
    filename: String(req.body.filename || 'registro.html'),
    guildId: String(req.body.guildId || req.body.guild_id || ''),
    guildName: String(req.body.guildName || req.body.guild_name || info.guildName || ''),
    channelName: rawChannel,
    ticketId,
    clientName: String(req.body.clientName || req.body.client_name || req.body.customerName || req.body.userName || info.clientName || inferredClient || ''),
    staffName: String(req.body.staffName || req.body.staff_name || req.body.closedByTag || req.body.closed_by_tag || info.staffName || ''),
    closedAt: String(req.body.closedAt || req.body.closed_at || new Date().toISOString()),
    messageCount: Number.isFinite(supplied) && supplied > 0 ? supplied : info.messageCount,
    profiles: info.profiles,
    theme: normalizeTheme(req.body.theme || req.body.color || req.body.primaryColor),
    createdAt: new Date().toISOString()
  };

  saveData(data);
  res.json({ ok: true, id, url: `${baseUrl(req)}/t/${id}`, rawUrl: `${baseUrl(req)}/raw/${id}` });
});

app.get('/t/:id', (req, res) => {
  const data = loadData();
  cleanupExpired(data);
  const record = data.records[req.params.id];
  if (!record) {
    return res.status(404).send(shell('Transcript não encontrado', `<section class="hero glass"><div class="hero-copy"><span class="eyebrow">Erro</span><h1>Transcript não encontrado</h1><p>O link pode estar incorreto ou o registro pode ter expirado.</p></div></section>`));
  }
  res.send(transcriptPage(req.params.id, record));
});

app.get('/raw/:id', (req, res) => {
  const data = loadData();
  cleanupExpired(data);
  const record = data.records[req.params.id];
  if (!record) return res.status(404).send('Registro não encontrado.');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.send(styleRawTranscript(record.html, record.theme));
});

app.get('/admin', (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).send(shell('Acesso restrito', `<section class="hero glass"><div class="hero-copy"><span class="eyebrow">Administração</span><h1>Acesso restrito</h1><p>O painel exige uma chave válida.</p></div></section>`));
  }
  const data = loadData();
  cleanupExpired(data);
  const ttl = Number(data.settings.ttlDays ?? DEFAULT_TTL_DAYS);
  const records = Object.entries(data.records || {}).sort((a, b) => Date.parse(b[1].createdAt || '') - Date.parse(a[1].createdAt || ''));
  const rows = records.map(([id, r]) => {
    const i = inferInfo(r.html);
    const ticket = cleanTicketName(r.ticketId || r.channelName || i.channelName || id) || id;
    return `<tr><td>${esc(ticket)}</td><td>${esc(r.guildName || i.guildName || '-')}</td><td>${esc(brDate(r.createdAt))}</td><td>${esc(expiresAt(r.createdAt, ttl))}</td><td><div style="display:flex;gap:7px;flex-wrap:wrap"><a class="btn" href="/t/${attr(id)}" target="_blank">Abrir</a><form method="post" action="/admin/delete"><input type="hidden" name="key" value="${attr(adminKeyFrom(req))}"><input type="hidden" name="id" value="${attr(id)}"><button class="btn" type="submit">Apagar</button></form></div></td></tr>`;
  }).join('');

  res.send(shell('Painel de transcripts', `<section class="panel glass"><h1>Painel de transcripts</h1><p>Total salvo: <strong>${records.length}</strong>.</p><form class="settings" method="post" action="/admin/settings"><input type="hidden" name="key" value="${attr(adminKeyFrom(req))}"><label>Dias para apagar automaticamente<input type="number" name="ttlDays" min="0" max="3650" value="${attr(ttl)}"></label><button class="btn primary" type="submit">Salvar</button><a class="btn" href="/admin/cleanup?key=${encodeURIComponent(adminKeyFrom(req))}">Limpar expirados</a></form>${records.length ? `<table><thead><tr><th>Ticket</th><th>Servidor</th><th>Criado</th><th>Expira</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">Nenhum transcript salvo ainda.</div>`}</section>`));
});

app.post('/admin/settings', (req, res) => {
  if (!isAdmin(req)) return res.status(403).send('Acesso negado.');
  const data = loadData();
  const ttl = Math.max(0, Math.min(3650, Number(req.body.ttlDays || DEFAULT_TTL_DAYS)));
  data.settings.ttlDays = Number.isFinite(ttl) ? ttl : DEFAULT_TTL_DAYS;
  saveData(data);
  res.redirect(`/admin?key=${encodeURIComponent(adminKeyFrom(req))}`);
});

app.post('/admin/delete', (req, res) => {
  if (!isAdmin(req)) return res.status(403).send('Acesso negado.');
  const data = loadData();
  const id = String(req.body.id || '');
  if (id && data.records[id]) {
    delete data.records[id];
    saveData(data);
  }
  res.redirect(`/admin?key=${encodeURIComponent(adminKeyFrom(req))}`);
});

app.get('/admin/cleanup', (req, res) => {
  if (!isAdmin(req)) return res.status(403).send('Acesso negado.');
  const data = loadData();
  cleanupExpired(data);
  res.redirect(`/admin?key=${encodeURIComponent(adminKeyFrom(req))}`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Proton Tickets online na porta ${port}`));
