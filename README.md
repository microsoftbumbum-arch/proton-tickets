# Proton Tickets

Site de transcripts do Proton For Seller.

## Atualização mobile

- removido o cabeçalho com ícone/letra P e textos de marca do topo do transcript;
- layout mobile mais compacto e organizado;
- campos sem informação deixam de aparecer em vez de mostrar “Não informado”;
- cliente é inferido pelo nome do canal quando possível, como `ticket-suporte-usuario`;
- ticket é limpo para evitar títulos como `Atendimento - ticket-...`;
- avatares, emojis personalizados, imagens e anexos continuam sendo exibidos pelo HTML original do transcript;
- compatibilidade com os campos opcionais enviados pelo bot: `guildName`, `clientName`, `staffName`, `ticketId`, `channelName`, `messageCount` e `closedAt`.

## Render

Build Command:

```txt
npm install
```

Start Command:

```txt
npm start
```
