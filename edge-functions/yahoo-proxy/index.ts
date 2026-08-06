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

    if (type === 'options') {
      const date = url.searchParams.get('date'); // unix seconds, opcional (padrão = próximo vencimento)
      const yUrl = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}` + (date ? `?date=${date}` : '');
      const res = await fetch(yUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const json = await res.json();
      const result = json?.optionChain?.result?.[0];
      if (!result) throw new Error('Sem dados de opções para este ativo');
      const body = {
        price: result.quote?.regularMarketPrice ?? null,
        expirationDates: result.expirationDates || [],
        calls: result.options?.[0]?.calls || [],
        puts: result.options?.[0]?.puts || [],
      };
      return new Response(JSON.stringify(body), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (type === 'dividends') {
      const [summaryRes, historyRes] = await Promise.all([
        fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=summaryDetail,defaultKeyStatistics,calendarEvents,assetProfile,price`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }),
        fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2y&interval=1mo&events=div`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }),
      ]);
      const summaryJson = await summaryRes.json();
      const historyJson = await historyRes.json();

      const detail = summaryJson?.quoteSummary?.result?.[0]?.summaryDetail;
      const calendar = summaryJson?.quoteSummary?.result?.[0]?.calendarEvents;
      const profile = summaryJson?.quoteSummary?.result?.[0]?.assetProfile;
      const priceModule = summaryJson?.quoteSummary?.result?.[0]?.price;
      const price = priceModule?.regularMarketPrice?.raw ?? detail?.previousClose?.raw ?? null;
      const dividendYield = detail?.dividendYield?.raw ?? null; // fração (ex: 0.045 = 4.5%)
      const dividendRate = detail?.dividendRate?.raw ?? null; // valor anual estimado
      const exDividendDate = detail?.exDividendDate?.raw ?? null; // unix seconds
      const sector = profile?.sector ?? null;
      // próximo pagamento — estimativa do Yahoo, só disponível pro próximo dividendo,
      // não temos as datas de pagamento passadas de forma confiável (só a ex-dividendo)
      const nextPaymentDate = calendar?.dividendDate?.raw ?? null;

      const divEvents = historyJson?.chart?.result?.[0]?.events?.dividends || {};
      const history = Object.values(divEvents)
        .map((d) => ({ exDate: d.date, amount: d.amount })) // "date" aqui é a data ex-dividendo
        .sort((a, b) => b.exDate - a.exDate)
        .slice(0, 6);

      const debug = (price == null && sector == null && dividendYield == null)
        ? {
            summaryHttpStatus: summaryRes.status,
            summaryError: summaryJson?.quoteSummary?.error ?? null,
            summaryHasResult: !!summaryJson?.quoteSummary?.result,
          }
        : undefined;

      return new Response(JSON.stringify({
        price, dividendYield, dividendRate, exDividendDate, nextPaymentDate, sector, history,
        ...(debug ? { debug } : {}),
      }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (type === 'br_options') {
      // Fonte: portal público e gratuito da OpLab (sem login/token).
      // Não é API oficial — extraímos direto do HTML. Se o layout deles mudar,
      // o parser pode quebrar; nesse caso devolvemos uma amostra do HTML pra ajuste.
      const pageUrl = `https://opcoes.oplab.com.br/mercado/acoes/opcoes/${symbol}`;
      const res = await fetch(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await res.text();

      const toNum = (s) => {
        if (!s) return null;
        const cleaned = String(s).replace(/[^\d.,\-]/g, ''); // remove "R$", espaços, "%", etc.
        const n = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
        return isNaN(n) ? null : n;
      };

      // preço do ativo: primeiro "R$ X,XX" que aparece após o símbolo no HTML
      let price = null;
      const priceMatch = html.match(new RegExp(symbol + '[\\s\\S]{0,200}?R\\$\\s*([\\d.,]+)'));
      if (priceMatch) price = toNum(priceMatch[1]);

      // tenta extrair linhas de tabela <tr>/<td> (estrutura mais comum p/ grids de dados)
      const rows = [];
      const trMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
      for (const tr of trMatches) {
        const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [])
          .map(td => td.replace(/<[^>]+>/g, '').trim());
        if (cells.length < 8) continue; // precisa pelo menos até "Último"
        const [code, tipo, strikeRaw, volRaw, moneyness, diasRaw, teoricoRaw, deltaRaw,
          lastRaw, varRaw, midRaw, bidRaw, askRaw, volFinRaw, viRaw, veRaw, exercicioRaw] = cells;
        if (!code || !/CALL|PUT/i.test(tipo || '')) continue;
        const diasMatch = (diasRaw || '').match(/(\d+)/);
        const exercicioUpper = (exercicioRaw || '').toUpperCase();
        rows.push({
          contractSymbol: code,
          type: /CALL/i.test(tipo) ? 'call' : 'put',
          strike: toNum(strikeRaw),
          impliedVolatility: toNum(volRaw) != null ? toNum(volRaw) / 100 : null,
          moneyness: (moneyness || '').toUpperCase(),
          dias: diasMatch ? parseInt(diasMatch[1]) : null,
          delta: parseFloat((deltaRaw || '').replace(',', '.')),
          lastPrice: toNum(lastRaw),
          bid: toNum(bidRaw),
          ask: toNum(askRaw),
          exercicio: exercicioUpper.includes('EUROP') ? 'europeia'
            : exercicioUpper.includes('AMERIC') ? 'americana' : null,
        });
      }

      if (rows.length === 0) {
        // modo diagnóstico: devolve um pedaço do HTML perto da grade pra gente ajustar o parser
        const anchor = html.indexOf('Grade de op');
        const sample = anchor >= 0 ? html.slice(anchor, anchor + 3000) : html.slice(0, 3000);
        return new Response(JSON.stringify({
          error: 'parse_failed',
          message: 'Não consegui extrair a grade de opções — o layout da página pode não usar <table>/<tr>/<td>.',
          htmlSample: sample,
        }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ price, options: rows }), {
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
