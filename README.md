# Stock Monitor — BR + US

PWA de monitoramento de ações (B3 e US), com watchlist, posições, gráfico estilo
TradingView (Lightweight Charts) e sinais de entrada configuráveis por indicador.

## Setup

### 1. Supabase
1. Crie um projeto em supabase.com
2. Rode `supabase_schema.sql` no SQL Editor
3. Copie a `URL` e a `anon key` do projeto (Settings > API)
4. Cole no topo do `index.html`:
   ```js
   const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
   const SUPABASE_ANON_KEY = 'SUA_ANON_KEY';
   ```

### 2. Edge Functions (proxy Yahoo Finance + checagem de sinais)
```bash
supabase functions deploy yahoo-proxy --no-verify-jwt
supabase functions deploy check-signals --no-verify-jwt
```

Gere as chaves VAPID pra push notification:
```bash
npx web-push generate-vapid-keys
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
```

Configure o cron da `check-signals` (Dashboard > Edge Functions > seu function > Cron):
```
*/5 * * * *
```
(roda a cada 5 min — o menor intervalo disponível nas regras; a function já ignora
regras cujo `check_interval_minutes` ainda não venceu se você adicionar essa lógica
de "última checagem" — hoje ela roda a checagem em toda execução do cron, ajuste
conforme quiser economizar chamadas ao Yahoo).

### 3. Deploy do PWA
Igual seus outros projetos — GitHub Pages:
```bash
git init && git add . && git commit -m "stock monitor v1"
git remote add origin https://github.com/SEU_USER/stock-monitor.git
git push -u origin main
```
Ative GitHub Pages nas configurações do repo. **Não esqueça do `.nojekyll`** (arquivo
vazio na raiz) pra evitar problemas de build do Jekyll, como nos outros projetos.

### 4. Push notification no iPhone
No Safari, adicione o PWA à tela de início (necessário iOS 16.4+) e aceite a
permissão de notificação na primeira vez que o app pedir — isso ainda precisa ser
implementado no `index.html` (registro do push subscription + gravação em
`push_subscriptions`). Deixei a service worker (`sw.js`) já pronta pra receber e
exibir os pushes; falta o botão "Ativar notificações" que chama
`registration.pushManager.subscribe(...)` e salva o resultado no Supabase.

## O que já está pronto
- Dois módulos (BR/US) com watchlist e posições
- Gráfico candlestick com seletor de período (1D/1S/1M/6M/1A/Tudo)
- 16 indicadores disponíveis, incluindo **HiLo Activator com período configurável**
- Overlay no gráfico: HiLo, SMA cross, Bollinger (os demais têm o cálculo pronto em
  JS, só falta plotar — RSI/MACD/Estocástico normalmente vão num painel abaixo do
  candlestick, não sobrepostos)
- Tela de configuração de monitoramento por ação (adicionar/ativar/desativar/remover
  regras, intervalo 5/15/30 min)
- Schema completo no Supabase
- Edge Function de proxy Yahoo Finance (contorna CORS)
- Edge Function de checagem de sinais (cron) com lógica de HiLo e SMA cross prontas;
  demais indicadores têm um `TODO` marcado — é só espelhar as funções do `index.html`

## Próximos passos sugeridos
1. Testar o proxy Yahoo Finance com um símbolo BR (`PETR4.SA`) e um US (`AAPL`)
2. Implementar o botão de ativar push notification no app
3. Adicionar painéis separados abaixo do candlestick pra RSI/MACD/Estocástico
   (o Lightweight Charts suporta múltiplos paines com `chart.addPane()` — ou usar
   `priceScaleId` separado no mesmo chart)
4. Completar os indicadores restantes no `check-signals` (ATR, Bollinger, RSI, etc.)
5. Testar em PWA real no iPhone (comportamento de push, service worker cache)
