import { Router } from 'express';
import { query } from '../config/database.js';
import { getFullMarketData } from '../services/binanceService.js';
import { getFullCMCData } from '../services/coinmarketcapService.js';
import { analyzeMarket } from '../services/claudeService.js';

const router = Router();

// GET /analysis — historial de análisis
router.get('/', async (req, res) => {
  const { symbol, recommendation, limit = 20, offset = 0 } = req.query;
  const conditions = [];
  const values = [];
  let i = 1;

  if (symbol)         { conditions.push(`symbol ILIKE $${i++}`);         values.push(`%${symbol}%`); }
  if (recommendation) { conditions.push(`recommendation = $${i++}`);    values.push(recommendation.toUpperCase()); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const { rows } = await query(`
      SELECT id, symbol, timeframe, recommendation, confidence, risk_level,
             reasoning, suggested_entry, suggested_sl, suggested_tp1, suggested_tp2,
             ai_input_tokens, ai_output_tokens, created_at
      FROM market_analyses
      ${where}
      ORDER BY created_at DESC
      LIMIT $${i++} OFFSET $${i}
    `, [...values, limit, offset]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analysis/:id — análisis completo
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM market_analyses WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Análisis no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /analysis/manual — análisis manual bajo demanda (sin alerta de TV)
router.post('/manual', async (req, res) => {
  const { symbol, timeframe = '1h', action = 'analysis' } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol es requerido' });

  try {
    const [marketData, cmcData] = await Promise.allSettled([
      getFullMarketData(symbol.toUpperCase(), timeframe),
      getFullCMCData(symbol.toUpperCase()),
    ]);

    const market = marketData.status === 'fulfilled' ? marketData.value : null;
    const cmc    = cmcData.status === 'fulfilled'    ? cmcData.value    : null;

    const { analysis, usage } = await analyzeMarket({
      symbol: symbol.toUpperCase(),
      timeframe,
      action,
      marketData: market,
      cmcData:    cmc,
      alertPayload: {},
    });

    // Guardar en DB
    const { rows } = await query(
      `INSERT INTO market_analyses
        (symbol, timeframe, market_data, ai_analysis, recommendation, confidence,
         risk_level, reasoning, suggested_entry, suggested_sl, suggested_tp1, suggested_tp2,
         ai_input_tokens, ai_output_tokens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        symbol.toUpperCase(), timeframe,
        JSON.stringify(market || {}),
        analysis.technical_summary || '',
        analysis.recommendation,
        analysis.confidence,
        analysis.risk_level,
        analysis.reasoning,
        analysis.suggested_entry || null,
        analysis.suggested_sl || null,
        analysis.suggested_tp1 || null,
        analysis.suggested_tp2 || null,
        usage.input_tokens,
        usage.output_tokens,
      ]
    );

    res.json({ ...rows[0], full_analysis: analysis });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analysis/stats/recommendations — distribución de recomendaciones
router.get('/stats/recommendations', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        recommendation,
        COUNT(*) AS count,
        ROUND(AVG(confidence), 1) AS avg_confidence,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS last_7_days
      FROM market_analyses
      GROUP BY recommendation
      ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
