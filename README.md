# Proton Tickets

Versao simples sem pastas, feita para subir pelo celular.

## Render

Build Command:

```txt
npm install
```

Start Command:

```txt
npm start
```

Environment Variable opcional:

```txt
PUBLIC_URL=https://proton-tickets.onrender.com
```

## API

POST `/api/transcripts`

Body JSON:

```json
{
  "html": "<html>...</html>",
  "filename": "registro.html"
}
```

Resposta:

```json
{
  "ok": true,
  "id": "...",
  "url": "https://proton-tickets.onrender.com/t/..."
}
```
