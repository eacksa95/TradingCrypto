import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { query } from '../config/database.js';
import { getFullMarketData } from '../services/binanceService.js';
import { getFullCMCData } from '../services/coinmarketcapService.js';
import { analyzeMarket } from '../services/claudeService.js';

const router = Router();

/**
 * POST /alerts/webhook
 * Endpoint receptor de alertas de TradingView.
 *
 * TradingView envía el webhook en el body como JSON.
 * Payload esperado (configurable desde el Pine Script):
 * {
 *   "secret":    "tu_token_secreto",   ← validación de seguridad
 *   "symbol":    "BTCUSDT",
 *   "action":    "long",               ← long | short | close_long | close_short | buy | sell
 *   "timeframe": "1h",
 *   "price":     {{close}},
 *   "volume":    {{volume}},
 *   "strategy":  "EMA_RSI_v1",
 *   "indicator": "EMA Cross",
 *   ...campos extras opcionales...
 * }
 */
router.post('/webhook',
  [body('symbol').trim().notEmpty(), body('action').trim().notEmpty()],
  async (req, res) => {
    // Validar token secreto
    const secret = req.body.secret || req.headers['x-tradingview-secret'];
    if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
      console.warn('[Webhook] Token inválido desde:', req.ip);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      symbol, action, timeframe, price, volume,
      strategy: strategy_name, indicator: indicator_name,
      secret: _secret, // excluir del extra_data
      ...extraFields
    } = req.body;

    const symbolUpper = symbol.toUpperCase();
    const actionLower = action.toLowerCase();

    console.log(`[Webhook] Alerta recibida: ${actionLower.toUpperCase()} ${symbolUpper} @ ${price || 'N/A'}`);

    try {
      // 1. Guardar la alerta en la DB
      const { rows: alertRows } = await query(
        `INSERT INTO tv_alerts
          (symbol, timeframe, action, price, volume, indicator_name, strategy_name, extra_data, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          symbolUpper,
          timeframe || null,
          actionLower,
          price ? parseFloat(price) : null,
          volume ? parseFloat(volume) : null,
          indicator_name || null,
          strategy_name || null,
          JSON.stringify(extraFields),
          JSON.stringify(req.body),
        ]
      );

      const alert = alertRows[0];

      // 2. Responder inmediatamente a TradingView (debe ser rápido)
      res.status(200).json({ received: true, alert_id: alert.id });

      // 3. Proceso asíncrono: obtener datos de mercado y analizar con Claude
      processAlertAsync(alert).catch(err =>
        console.error('[Webhook] Error en procesamiento async:', err.message)
      );

    } catch (err) {
      console.error('[Webhook] Error guardando alerta:', err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * Proceso asíncrono: obtiene datos de mercado y genera análisis con IA
 */
async function processAlertAsync(alert) {
  console.log(`[Analysis] Iniciando análisis para alerta ${alert.id} — ${alert.symbol}`);

  try {
    // Obtener datos de mercado en paralelo
    const [marketData, cmcData] = await Promise.allSettled([
      getFullMarketData(alert.symbol, alert.timeframe || '1h'),
      getFullCMCData(alert.symbol),
    ]);

    const market = marketData.status === 'fulfilled' ? marketData.value : null;
    const cmc    = cmcData.status === 'fulfilled'    ? cmcData.value    : null;

    if (!market) {
      console.warn('[Analysis] No se pudieron obtener datos de Binance para', alert.symbol);
    }

    // Análisis con Claude
    const { analysis, usage } = await analyzeMarket({
      symbol:       alert.symbol,
      timeframe:    alert.timeframe,
      action:       alert.action,
      marketData:   market,
      cmcData:      cmc,
      alertPayload: { ...alert.extra_data, price: alert.price, volume: alert.volume },
    });

    // Guardar análisis en DB
    const { rows: anaRows } = await query(
      `INSERT INTO market_analyses
        (alert_id, symbol, timeframe, market_data, ai_analysis, recommendation, confidence,
         risk_level, reasoning, suggested_entry, suggested_sl, suggested_tp1, suggested_tp2,
         ai_input_tokens, ai_output_tokens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [
        alert.id,
        alert.symbol,
        alert.timeframe || null,
        JSON.stringify({ ...market, indicators: market?.indicators }),
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

    // Vincular análisis con la alerta
    await query(
      `UPDATE tv_alerts SET analysis_id = $1, is_processed = TRUE WHERE id = $2`,
      [anaRows[0].id, alert.id]
    );

    console.log(`[Analysis] Completado: ${analysis.recommendation} (confianza: ${analysis.confidence}%) para ${alert.symbol}`);
  } catch (err) {
    console.error('[Analysis] Error:', err.message);
    // Marcar como procesada aunque haya error
    await query('UPDATE tv_alerts SET is_processed = TRUE WHERE id = $1', [alert.id]).catch(() => {});
  }
}

// GET /alerts — listar alertas con su análisis
router.get('/', async (req, res) => {
  const { symbol, processed, limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const values = [];
  let i = 1;

  if (symbol)    { conditions.push(`a.symbol ILIKE $${i++}`); values.push(`%${symbol}%`); }
  if (processed !== undefined) {
    conditions.push(`a.is_processed = $${i++}`);
    values.push(processed === 'true');
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const { rows } = await query(`
      SELECT a.*,
        ma.recommendation, ma.confidence, ma.risk_level, ma.reasoning,
        ma.suggested_entry, ma.suggested_sl, ma.suggested_tp1, ma.suggested_tp2
      FROM tv_alerts a
      LEFT JOIN market_analyses ma ON ma.id = a.analysis_id
      ${where}
      ORDER BY a.created_at DESC
      LIMIT $${i++} OFFSET $${i}
    `, [...values, limit, offset]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /alerts/:id — detalle de alerta con análisis completo
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT a.*, row_to_json(ma.*) AS analysis
      FROM tv_alerts a
      LEFT JOIN market_analyses ma ON ma.id = a.analysis_id
      WHERE a.id = $1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Alerta no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /alerts/:id/reanalyze — forzar reanálisis
router.post('/:id/reanalyze', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM tv_alerts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Alerta no encontrada' });

    res.json({ message: 'Reanálisis iniciado', alert_id: req.params.id });
    processAlertAsync(rows[0]).catch(console.error);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
