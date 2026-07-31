// Supabase Edge Function: yahoo-proxy
// Proxeia chamadas ao Yahoo Finance (que bloqueia CORS direto do navegador).
// Deploy: supabase functions deploy yahoo-proxy --no-verify-jwt
//
// Uso:
//   GET /functions/v1/yahoo-proxy?symbol=PETR4.SA&type=quote
//   GET /functions/v1/yahoo-proxy?symbol=AAPL&type=history&range=1y&interval=1d

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const symbol = url.searchParams.get('symbol');
  const type = url.searchParams.get('type') || 'quote';

  if (!symbol) {
    return new Response(JSON.stringify({ error: 'symbol é obrigatório' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    if (type === 'quote') {
      const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
      const res = await fetch(yUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const json = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta) throw new Error('Símbolo não encontrado');
      const body = {
        price: meta.regularMarketPrice,
        previousClose: meta.chartPreviousClose,
        change: meta.regularMarketPrice - meta.chartPreviousClose,
        changePercent: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100,
        currency: meta.currency,
      };
      return new Response(JSON.stringify(body), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (type === 'history') {
      const range = url.searchParams.get('range') || '1y';
      const interval = url.searchParams.get('interval') || '1d';
      const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
      const res = await fetch(yUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error('Símbolo não encontrado');
      const timestamps = result.timestamp || [];
      const quote = result.indicators.quote[0];
      const candles = timestamps.map((t, i) => ({
        time: t,
        open: quote.open[i],
        high: quote.high[i],
        low: quote.low[i],
        close: quote.close[i],
        volume: quote.volume[i],
      })).filter(c => c.open != null && c.close != null);
      return new Response(JSON.stringify({ candles }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'type inválido' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
