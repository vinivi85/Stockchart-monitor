// Supabase Edge Function: check-signals
// Roda em cron (ex: a cada 5 min — o menor intervalo configurável).
// Para cada regra ativa cujo intervalo já "venceu", busca candles, calcula o indicador
// e dispara push + grava em alerts_log se a condição for satisfeita.
//
// Deploy: supabase functions deploy check-signals --no-verify-jwt
// Cron (Supabase Dashboard > Edge Functions > Cron, ou pg_cron):
//   */5 * * * * -> chama esta function
//
// Requer secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// (configure com: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'https://esm.sh/web-push@3.6.7';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

webpush.setVapidDetails(
  'mailto:you@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
);

// --- mesma lógica de indicadores do index.html, versão mínima p/ checagem ---
function sma(values: number[], period: number) {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    out.push(sum / period);
  }
  return out;
}

function hilo(candles: any[], period = 3) {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const smaHigh = sma(highs, period);
  const smaLow = sma(lows, period);
  let currentTrend: string | null = null;
  const trend: (string | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (smaHigh[i] == null || smaLow[i] == null) { trend.push(null); continue; }
    const close = candles[i].close;
    if (close > (smaHigh[i] as number)) currentTrend = 'up';
    else if (close < (smaLow[i] as number)) currentTrend = 'down';
    trend.push(currentTrend);
  }
  return trend;
}

async function fetchCandles(symbol: string) {
  const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=6mo`;
  const res = await fetch(yUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return [];
  const timestamps = result.timestamp || [];
  const quote = result.indicators.quote[0];
  return timestamps.map((t: number, i: number) => ({
    time: t, open: quote.open[i], high: quote.high[i], low: quote.low[i],
    close: quote.close[i], volume: quote.volume[i],
  })).filter((c: any) => c.close != null);
}

function checkCondition(indicatorType: string, params: any, candles: any[]): boolean {
  if (candles.length < 5) return false;
  if (indicatorType === 'hilo') {
    const trend = hilo(candles, params.period || 3);
    const last = trend[trend.length - 1];
    const prev = trend[trend.length - 2];
    // sinal de compra = trend virou de 'down' pra 'up' na última barra
    return prev === 'down' && last === 'up';
  }
  if (indicatorType === 'sma_cross') {
    const closes = candles.map(c => c.close);
    const fast = sma(closes, params.fast || 9);
    const slow = sma(closes, params.slow || 21);
    const n = closes.length;
    if (fast[n - 1] == null || slow[n - 1] == null || fast[n - 2] == null || slow[n - 2] == null) return false;
    return (fast[n - 2] as number) <= (slow[n - 2] as number) && (fast[n - 1] as number) > (slow[n - 1] as number);
  }
  // TODO: replicar demais indicadores (rsi, macd, bollinger, etc.) espelhando index.html
  return false;
}

Deno.serve(async () => {
  const now = new Date();
  const { data: rules } = await supabase
    .from('monitoring_rules')
    .select('*, watchlist(*)')
    .eq('active', true);

  if (!rules) return new Response('sem regras ativas');

  const { data: subs } = await supabase.from('push_subscriptions').select('*');

  for (const rule of rules) {
    try {
      const candles = await fetchCandles(rule.watchlist.yahoo_symbol);
      if (candles.length === 0) continue;
      const triggered = checkCondition(rule.indicator_type, rule.params, candles);
      if (!triggered) continue;

      const lastPrice = candles[candles.length - 1].close;

      // evita duplicar alerta no mesmo dia
      const { data: existing } = await supabase
        .from('alerts_log')
        .select('id')
        .eq('rule_id', rule.id)
        .gte('triggered_at', new Date(now.getTime() - 24 * 3600 * 1000).toISOString());
      if (existing && existing.length > 0) continue;

      await supabase.from('alerts_log').insert({
        watchlist_id: rule.watchlist_id, rule_id: rule.id,
        price_at_trigger: lastPrice, notified: true,
      });

      const payload = JSON.stringify({
        title: `Sinal de compra: ${rule.watchlist.ticker}`,
        body: `${rule.indicator_type} indicou possível entrada. Preço: ${lastPrice}`,
        url: './index.html',
      });

      for (const sub of subs || []) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
        } catch (_) { /* subscription pode ter expirado */ }
      }
    } catch (e) {
      console.error(`erro na regra ${rule.id}:`, e.message);
    }
  }

  return new Response('ok');
});
