import { Router } from 'express';
import { getFullMarketData, getTicker, getPrice } from '../services/binanceService.js';
import { getGlobalMetrics, getCryptoInfo } from '../services/coinmarketcapService.js';
import { query } from '../config/database.js';

const router = Router();

// GET /market/price/:symbol — precio rápido
router.get('/price/:symbol', async (req, res) => {
  try {
    const price = await getPrice(req.params.symbol.toUpperCase());
    res.json({ symbol: req.params.symbol.toUpperCase(), price });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /market/ticker/:symbol — ticker 24h completo
router.get('/ticker/:symbol', async (req, res) => {
  try {
    const ticker = await getTicker(req.params.symbol.toUpperCase());
    res.json(ticker);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /market/data/:symbol — datos completos para análisis
router.get('/data/:symbol', async (req, res) => {
  const { timeframe = '1h' } = req.query;
  try {
    const data = await getFullMarketData(req.params.symbol.toUpperCase(), timeframe);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /market/global — métricas globales del mercado
router.get('/global', async (req, res) => {
  try {
    const global = await getGlobalMetrics();
    if (!global) return res.status(503).json({ error: 'CoinMarketCap no configurado' });
    res.json(global);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /market/crypto/:symbol — info de la cripto en CMC
router.get('/crypto/:symbol', async (req, res) => {
  try {
    const info = await getCryptoInfo(req.params.symbol.toUpperCase());
    if (!info) return res.status(503).json({ error: 'CoinMarketCap no configurado o símbolo no encontrado' });
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /market/symbols — símbolos trackeados en DB
router.get('/symbols', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM symbols WHERE is_tracked = TRUE ORDER BY symbol');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /market/symbols — agregar símbolo a trackear
router.post('/symbols', async (req, res) => {
  const { symbol, base_asset, quote_asset = 'USDT', exchange = 'binance' } = req.body;
  if (!symbol || !base_asset) return res.status(400).json({ error: 'symbol y base_asset son requeridos' });

  try {
    const { rows } = await query(
      `INSERT INTO symbols (symbol, base_asset, quote_asset, exchange)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (symbol) DO UPDATE SET is_tracked = TRUE, notes = EXCLUDED.notes
       RETURNING *`,
      [symbol.toUpperCase(), base_asset.toUpperCase(), quote_asset.toUpperCase(), exchange]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
