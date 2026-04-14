import axios from 'axios';

const cmc = axios.create({
  baseURL: 'https://pro-api.coinmarketcap.com/v1',
  timeout: 8000,
  headers: {
    'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY || '',
    'Accept': 'application/json',
  },
});

/**
 * Obtiene datos globales del mercado (dominancia BTC, market cap total, etc.)
 */
export async function getGlobalMetrics() {
  if (!process.env.CMC_API_KEY) return null;
  try {
    const { data } = await cmc.get('/global-metrics/quotes/latest');
    const d = data.data;
    return {
      totalMarketCap:  d.quote.USD.total_market_cap,
      totalVolume24h:  d.quote.USD.total_volume_24h,
      btcDominance:    d.btc_dominance,
      ethDominance:    d.eth_dominance,
      activeCurrencies: d.active_cryptocurrencies,
      marketCapChange24h: d.quote.USD.total_market_cap_yesterday_percentage_change,
    };
  } catch (err) {
    console.warn('[CMC] getGlobalMetrics error:', err.message);
    return null;
  }
}

/**
 * Obtiene métricas de una criptomoneda por su símbolo (ej: BTC, ETH, SOL)
 */
export async function getCryptoInfo(symbol) {
  if (!process.env.CMC_API_KEY) return null;
  // Extraer el asset base del par (BTCUSDT -> BTC)
  const baseAsset = symbol.replace(/USDT$|USDC$|BUSD$|BTC$|ETH$/, '');
  if (!baseAsset) return null;

  try {
    const { data } = await cmc.get('/cryptocurrency/quotes/latest', {
      params: { symbol: baseAsset, convert: 'USD' },
    });

    const coin = Object.values(data.data)[0];
    if (!coin) return null;

    return {
      name:         coin.name,
      rank:         coin.cmc_rank,
      marketCap:    coin.quote.USD.market_cap,
      volume24h:    coin.quote.USD.volume_24h,
      change1h:     coin.quote.USD.percent_change_1h,
      change24h:    coin.quote.USD.percent_change_24h,
      change7d:     coin.quote.USD.percent_change_7d,
      change30d:    coin.quote.USD.percent_change_30d,
      circulatingSupply: coin.circulating_supply,
      totalSupply:  coin.total_supply,
      maxSupply:    coin.max_supply,
    };
  } catch (err) {
    console.warn('[CMC] getCryptoInfo error:', err.message);
    return null;
  }
}

/**
 * Recopila datos completos de CMC para el análisis
 */
export async function getFullCMCData(symbol) {
  if (!process.env.CMC_API_KEY) return null;

  const [global, crypto] = await Promise.allSettled([
    getGlobalMetrics(),
    getCryptoInfo(symbol),
  ]);

  return {
    global: global.status === 'fulfilled' ? global.value : null,
    crypto: crypto.status === 'fulfilled' ? crypto.value : null,
    ...(global.status === 'fulfilled' && global.value
      ? { btcDominance: global.value.btcDominance }
      : {}),
    ...(crypto.status === 'fulfilled' && crypto.value
      ? {
          rank:    crypto.value.rank,
          marketCap: crypto.value.marketCap,
          change1h: crypto.value.change1h,
          change7d: crypto.value.change7d,
        }
      : {}),
  };
}
