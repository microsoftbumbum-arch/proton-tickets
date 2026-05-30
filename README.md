# Proton Tickets

Versao simples, sem pastas, feita para subir pelo celular no GitHub.

## Arquivos

- `server.js`: servidor Express com API e pagina de transcript.
- `package.json`: dependencias e comando de start.

## Rotas

- `GET /`: pagina inicial.
- `POST /api/transcripts`: recebe o HTML do transcript.
- `GET /t/:id`: mostra o transcript no navegador.

## Deploy no Render

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

## Exemplo para enviar transcript pelo bot

```js
const response = await fetch("https://SEU-SITE.onrender.com/api/transcripts", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ html: transcriptHtml })
});

const data = await response.json();
console.log(data.url);
```

## Observacao

Essa versao salva os transcripts na memoria. Se o servidor reiniciar, os transcripts antigos somem. Para comecar e testar, isso ja funciona.
