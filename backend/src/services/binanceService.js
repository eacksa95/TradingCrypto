import axios from 'axios';

const BASE_URL = process.env.BINANCE_TESTNET === 'true'
  ? 'https://testnet.binance.vision/api'
  : 'https://api.binance.com/api';

const binance = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    'X-MBX-APIKEY': process.env.BINANCE_API_KEY || '',
  },
});

/**
 * Precio actual (ticker 24h)
 */
export async function getTicker(symbol) {
  const { data } = await binance.get('/v3/ticker/24hr', { params: { symbol } });
  return data;
}

/**
 * Velas OHLCV
 * @param {string} symbol
 * @param {string} interval - 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
 * @param {number} limit - máx 1000
 */
export async function getKlines(symbol, interval = '1h', limit = 100) {
  const { data } = await binance.get('/v3/klines', {
    params: { symbol, interval, limit },
  });

  return data.map(k => ({
    openTime:   k[0],
    open:       parseFloat(k[1]),
    high:       parseFloat(k[2]),
    low:        parseFloat(k[3]),
    close:      parseFloat(k[4]),
    volume:     parseFloat(k[5]),
    closeTime:  k[6],
    quoteVolume: parseFloat(k[7]),
    trades:     k[8],
  }));
}

/**
 * Orderbook
 */
export async function getOrderBook(symbol, limit = 10) {
  const { data } = await binance.get('/v3/depth', { params: { symbol, limit } });
  return data;
}

/**
 * Precio simple
 */
export async function getPrice(symbol) {
  const { data } = await binance.get('/v3/ticker/price', { params: { symbol } });
  return parseFloat(data.price);
}

/**
 * Recopila todos los datos de mercado relevantes para el análisis
 */
export async function getFullMarketData(symbol, timeframe = '1h') {
  const interval = normalizeTimeframe(timeframe);

  // Llamadas paralelas
  const [ticker, klines, klines4h, klines1d, orderbook] = await Promise.allSettled([
    getTicker(symbol),
    getKlines(symbol, interval, 100),
    getKlines(symbol, '4h', 50),
    getKlines(symbol, '1d', 30),
    getOrderBook(symbol, 10),
  ]);

  const result = {
    symbol,
    timestamp: new Date().toISOString(),
    ticker: ticker.status === 'fulfilled' ? ticker.value : null,
    klines: klines.status === 'fulfilled' ? klines.value : [],
    klines4h: klines4h.status === 'fulfilled' ? klines4h.value : [],
    klines1d: klines1d.status === 'fulfilled' ? klines1d.value : [],
    orderbook: orderbook.status === 'fulfilled' ? orderbook.value : null,
  };

  // Calcular indicadores técnicos sobre las velas del timeframe solicitado
  if (result.klines.length > 0) {
    result.indicators = calculateIndicators(result.klines);
  }

  return result;
}

/**
 * Normaliza el timeframe de TradingView al formato de Binance
 */
function normalizeTimeframe(tf) {
  const map = {
    '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m',
    '60': '1h', '120': '2h', '240': '4h', '360': '6h', '720': '12h',
    '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h',
    '1d': '1d', 'D': '1d', '3d': '3d', '1w': '1w', 'W': '1w',
    '1M': '1M', 'M': '1M',
  };
  return map[tf] || '1h';
}

/**
 * Calcula indicadores técnicos básicos a partir de las velas
 */
function calculateIndicators(klines) {
  const closes  = klines.map(k => k.close);
  const highs   = klines.map(k => k.high);
  const lows    = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const n       = closes.length;

  return {
    rsi:       calculateRSI(closes, 14),
    ema20:     n >= 20  ? calculateEMA(closes, 20)  : null,
    ema50:     n >= 50  ? calculateEMA(closes, 50)  : null,
    ema200:    n >= 200 ? calculateEMA(closes, 200) : null,
    macd:      calculateMACD(closes),
    bollinger: calculateBollinger(closes, 20, 2),
    atr:       calculateATR(highs, lows, closes, 14),
    volumeSMA: calculateSMA(volumes, 20),
  };
}

function calculateSMA(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;
  const emaFast = calculateEMAFull(closes, fast);
  const emaSlow = calculateEMAFull(closes, slow);

  const macdLine = [];
  for (let i = 0; i < emaSlow.length; i++) {
    const idx = closes.length - emaSlow.length + i;
    macdLine.push(emaFast[emaFast.length - emaSlow.length + i] - emaSlow[i]);
  }

  const signalLine = calculateEMAFull(macdLine, signal);
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];

  return {
    macd:      lastMacd,
    signal:    lastSignal,
    histogram: lastMacd - lastSignal,
  };
}

function calculateEMAFull(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(ema);
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function calculateBollinger(closes, period = 20, stdDevMult = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper:  middle + stdDevMult * stdDev,
    middle,
    lower:  middle - stdDevMult * stdDev,
    stdDev,
    bandwidth: (stdDevMult * 2 * stdDev) / middle,
  };
}

function calculateATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const hl  = highs[i] - lows[i];
    const hpc = Math.abs(highs[i] - closes[i - 1]);
    const lpc = Math.abs(lows[i] - closes[i - 1]);
    trs.push(Math.max(hl, hpc, lpc));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}
