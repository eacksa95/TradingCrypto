import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Prompt de sistema: contexto del asistente de trading
const SYSTEM_PROMPT = `Eres un experto analista de criptomonedas y trader cuantitativo con más de 10 años de experiencia.
Tu rol es analizar datos de mercado en tiempo real y proporcionar recomendaciones de trading precisas y fundamentadas.

Analizas:
- Precio actual, volumen y variaciones
- Tendencias en múltiples timeframes
- Indicadores técnicos (RSI, MACD, EMA, Bollinger Bands, ATR)
- Orderbook y liquidez
- Métricas on-chain cuando estén disponibles
- Sentimiento del mercado y dominancia de BTC
- Niveles de soporte y resistencia clave

Para cada análisis debes responder en formato JSON con exactamente esta estructura:
{
  "recommendation": "LONG|SHORT|SPOT_BUY|SPOT_SELL|HOLD|AVOID",
  "confidence": <número 0-100>,
  "risk_level": "LOW|MEDIUM|HIGH|VERY_HIGH",
  "reasoning": "<explicación concisa de 2-4 oraciones>",
  "technical_summary": "<resumen técnico breve>",
  "suggested_entry": <precio o null>,
  "suggested_sl": <stop loss o null>,
  "suggested_tp1": <take profit 1 o null>,
  "suggested_tp2": <take profit 2 o null>,
  "key_levels": {
    "support": [<nivel1>, <nivel2>],
    "resistance": [<nivel1>, <nivel2>]
  },
  "warnings": ["<advertencia si hay algo importante>"],
  "market_context": "<contexto general del mercado en 1-2 oraciones>"
}

Sé conservador con las recomendaciones: si la señal no está clara, recomienda HOLD o AVOID.
Prioriza siempre la gestión del riesgo.`;

/**
 * Analiza datos de mercado con Claude y genera una recomendación de trading
 * @param {Object} params
 * @param {string} params.symbol - Par de trading (ej: BTCUSDT)
 * @param {string} params.timeframe - Timeframe de la alerta
 * @param {string} params.action - Acción de la alerta (long, short, buy, sell)
 * @param {Object} params.marketData - Datos de mercado de Binance
 * @param {Object} params.cmcData - Datos de CoinMarketCap (opcional)
 * @param {Object} params.alertPayload - Payload original de TradingView
 * @returns {Promise<Object>} Análisis y recomendación
 */
export async function analyzeMarket({ symbol, timeframe, action, marketData, cmcData, alertPayload }) {
  const userMessage = buildAnalysisPrompt({ symbol, timeframe, action, marketData, cmcData, alertPayload });

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: userMessage }
    ],
  });

  // Extraer el bloque de texto (puede haber thinking blocks primero)
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error('Claude no devolvió respuesta de texto');
  }

  // Parsear JSON de la respuesta
  let parsed;
  try {
    // Extraer JSON del texto (a veces viene con markdown)
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No se encontró JSON en la respuesta');
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[Claude] Error parseando JSON:', err.message);
    console.error('[Claude] Respuesta raw:', textBlock.text);
    // Devolver respuesta parcial con el texto crudo
    parsed = {
      recommendation: 'HOLD',
      confidence: 0,
      risk_level: 'HIGH',
      reasoning: 'Error al parsear la respuesta de IA',
      technical_summary: textBlock.text.slice(0, 500),
      suggested_entry: null,
      suggested_sl: null,
      suggested_tp1: null,
      suggested_tp2: null,
      key_levels: { support: [], resistance: [] },
      warnings: ['Error interno en el análisis'],
      market_context: '',
    };
  }

  return {
    analysis: parsed,
    rawText: textBlock.text,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens || 0,
    },
  };
}

/**
 * Construye el prompt de análisis con todos los datos de mercado
 */
function buildAnalysisPrompt({ symbol, timeframe, action, marketData, cmcData, alertPayload }) {
  const lines = [
    `## ALERTA RECIBIDA`,
    `- Símbolo: ${symbol}`,
    `- Timeframe: ${timeframe || 'N/A'}`,
    `- Señal de TradingView: ${action.toUpperCase()}`,
    '',
  ];

  if (marketData) {
    lines.push('## DATOS DE MERCADO (Binance)');

    if (marketData.ticker) {
      const t = marketData.ticker;
      lines.push(`- Precio actual: $${t.lastPrice}`);
      lines.push(`- Variación 24h: ${t.priceChangePercent}%`);
      lines.push(`- Volumen 24h (base): ${t.volume}`);
      lines.push(`- Volumen 24h (quote): $${t.quoteVolume}`);
      lines.push(`- High 24h: $${t.highPrice}`);
      lines.push(`- Low 24h: $${t.lowPrice}`);
      lines.push('');
    }

    if (marketData.klines && marketData.klines.length > 0) {
      lines.push(`### Velas recientes (${timeframe || '1h'})`);
      lines.push('| Time | Open | High | Low | Close | Volume |');
      lines.push('|------|------|------|-----|-------|--------|');
      // Mostrar últimas 10 velas
      const recent = marketData.klines.slice(-10);
      for (const k of recent) {
        const dt = new Date(k.openTime).toISOString().slice(11, 16);
        lines.push(`| ${dt} | ${k.open} | ${k.high} | ${k.low} | ${k.close} | ${parseFloat(k.volume).toFixed(2)} |`);
      }
      lines.push('');
    }

    if (marketData.orderbook) {
      const ob = marketData.orderbook;
      lines.push('### Orderbook (top 5)');
      lines.push('**Bids (compra):**');
      ob.bids?.slice(0, 5).forEach(([p, q]) => lines.push(`  $${p} × ${q}`));
      lines.push('**Asks (venta):**');
      ob.asks?.slice(0, 5).forEach(([p, q]) => lines.push(`  $${p} × ${q}`));
      lines.push('');
    }

    if (marketData.indicators) {
      const ind = marketData.indicators;
      lines.push('### Indicadores técnicos calculados');
      if (ind.rsi !== null) lines.push(`- RSI(14): ${ind.rsi?.toFixed(2)}`);
      if (ind.ema20 !== null) lines.push(`- EMA(20): ${ind.ema20?.toFixed(4)}`);
      if (ind.ema50 !== null) lines.push(`- EMA(50): ${ind.ema50?.toFixed(4)}`);
      if (ind.ema200 !== null) lines.push(`- EMA(200): ${ind.ema200?.toFixed(4)}`);
      if (ind.macd) {
        lines.push(`- MACD: ${ind.macd.macd?.toFixed(4)} | Signal: ${ind.macd.signal?.toFixed(4)} | Histogram: ${ind.macd.histogram?.toFixed(4)}`);
      }
      if (ind.bollinger) {
        lines.push(`- Bollinger Upper: ${ind.bollinger.upper?.toFixed(4)}`);
        lines.push(`- Bollinger Middle: ${ind.bollinger.middle?.toFixed(4)}`);
        lines.push(`- Bollinger Lower: ${ind.bollinger.lower?.toFixed(4)}`);
      }
      if (ind.atr !== null) lines.push(`- ATR(14): ${ind.atr?.toFixed(4)}`);
      if (ind.volumeSMA !== null) lines.push(`- Volume SMA(20): ${ind.volumeSMA?.toFixed(2)}`);
      lines.push('');
    }
  }

  if (cmcData) {
    lines.push('## DATOS DE COINMARKETCAP');
    if (cmcData.marketCap) lines.push(`- Market Cap: $${(cmcData.marketCap / 1e9).toFixed(2)}B`);
    if (cmcData.rank) lines.push(`- CMC Rank: #${cmcData.rank}`);
    if (cmcData.change1h) lines.push(`- Cambio 1h: ${cmcData.change1h?.toFixed(2)}%`);
    if (cmcData.change7d) lines.push(`- Cambio 7d: ${cmcData.change7d?.toFixed(2)}%`);
    if (cmcData.btcDominance) lines.push(`- Dominancia BTC: ${cmcData.btcDominance?.toFixed(2)}%`);
    if (cmcData.fearGreedIndex) lines.push(`- Fear & Greed Index: ${cmcData.fearGreedIndex}`);
    lines.push('');
  }

  if (alertPayload && Object.keys(alertPayload).length > 0) {
    lines.push('## DATOS ADICIONALES DE LA ALERTA');
    for (const [key, val] of Object.entries(alertPayload)) {
      if (!['symbol', 'action', 'timeframe', 'price'].includes(key)) {
        lines.push(`- ${key}: ${JSON.stringify(val)}`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`Analiza esta señal de ${action.toUpperCase()} en ${symbol} y proporciona tu recomendación en el formato JSON especificado.`);
  lines.push('Considera todos los datos anteriores para determinar si la señal es válida y si conviene ejecutar una operativa.');

  return lines.join('\n');
}

/**
 * Genera un resumen rápido de una operativa cerrada
 */
export async function summarizeTrade(trade) {
  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Genera un análisis breve de esta operativa cerrada en formato JSON:
{
  "performance": "good|neutral|bad",
  "key_lesson": "<lección principal en 1 oración>",
  "what_worked": "<qué funcionó bien>",
  "what_didnt": "<qué no funcionó o qué mejorar>",
  "risk_assessment": "<evaluación del manejo del riesgo>"
}

Datos de la operativa:
- Símbolo: ${trade.symbol}
- Tipo: ${trade.trade_type}
- Entrada: $${trade.entry_price}
- Salida: $${trade.exit_price}
- PnL: ${trade.pnl_percentage?.toFixed(2)}% (${trade.pnl > 0 ? '+' : ''}$${trade.pnl?.toFixed(2)})
- Leverage: ${trade.leverage}x
- Duración: ${trade.opened_at} → ${trade.closed_at}
- Stop Loss: ${trade.stop_loss ? '$' + trade.stop_loss : 'N/A'}
- Take Profit: ${trade.take_profit ? '$' + trade.take_profit : 'N/A'}
${trade.notes ? '- Notas: ' + trade.notes : ''}`
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  try {
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { performance: 'neutral', key_lesson: textBlock.text };
  }
}
