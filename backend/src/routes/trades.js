import { Router } from 'express';
import { body, param, query as qv, validationResult } from 'express-validator';
import { query } from '../config/database.js';
import { summarizeTrade } from '../services/claudeService.js';

const router = Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// GET /trades — listar con filtros opcionales
router.get('/', async (req, res) => {
  const { status, symbol, trade_type, wallet_id, limit = 50, offset = 0 } = req.query;

  const conditions = [];
  const values = [];
  let i = 1;

  if (status)     { conditions.push(`t.status = $${i++}`);     values.push(status); }
  if (symbol)     { conditions.push(`t.symbol ILIKE $${i++}`); values.push(`%${symbol}%`); }
  if (trade_type) { conditions.push(`t.trade_type = $${i++}`); values.push(trade_type); }
  if (wallet_id)  { conditions.push(`t.wallet_id = $${i++}`);  values.push(wallet_id); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const { rows } = await query(`
      SELECT t.*, w.name AS wallet_name, w.exchange AS wallet_exchange
      FROM trades t
      JOIN wallets w ON w.id = t.wallet_id
      ${where}
      ORDER BY t.opened_at DESC
      LIMIT $${i++} OFFSET $${i}
    `, [...values, limit, offset]);

    const count = await query(`SELECT COUNT(*) FROM trades t ${where}`, values);
    res.json({ data: rows, total: parseInt(count.rows[0].count), limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /trades/stats — estadísticas generales
router.get('/stats/summary', async (req, res) => {
  const { wallet_id } = req.query;
  const walletFilter = wallet_id ? 'AND wallet_id = $1' : '';
  const params = wallet_id ? [wallet_id] : [];

  try {
    const { rows } = await query(`
      SELECT
        COUNT(*) AS total_trades,
        COUNT(*) FILTER (WHERE status = 'closed') AS closed_trades,
        COUNT(*) FILTER (WHERE status = 'open') AS open_trades,
        COUNT(*) FILTER (WHERE status = 'closed' AND pnl > 0) AS winning_trades,
        COUNT(*) FILTER (WHERE status = 'closed' AND pnl < 0) AS losing_trades,
        COALESCE(SUM(pnl) FILTER (WHERE status = 'closed'), 0) AS total_pnl,
        COALESCE(AVG(pnl_percentage) FILTER (WHERE status = 'closed'), 0) AS avg_pnl_pct,
        COALESCE(MAX(pnl) FILTER (WHERE status = 'closed'), 0) AS best_trade,
        COALESCE(MIN(pnl) FILTER (WHERE status = 'closed'), 0) AS worst_trade,
        COALESCE(SUM(fees), 0) AS total_fees,
        -- Win rate
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE status = 'closed' AND pnl > 0)
          / NULLIF(COUNT(*) FILTER (WHERE status = 'closed'), 0), 2
        ) AS win_rate,
        -- Por tipo
        json_object_agg(trade_type, count) AS trades_by_type
      FROM trades
      WHERE 1=1 ${walletFilter}
    `, params);

    // PnL por mes
    const monthly = await query(`
      SELECT
        DATE_TRUNC('month', closed_at) AS month,
        SUM(pnl) AS pnl,
        COUNT(*) AS trades
      FROM trades
      WHERE status = 'closed' ${walletFilter}
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12
    `, params);

    res.json({ ...rows[0], monthly_pnl: monthly.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /trades/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT t.*, w.name AS wallet_name,
             a.ai_analysis, a.recommendation, a.confidence, a.risk_level
      FROM trades t
      JOIN wallets w ON w.id = t.wallet_id
      LEFT JOIN market_analyses a ON a.id::text = t.alert_id::text
      WHERE t.id = $1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Trade no encontrado' });

    const notes = await query(
      'SELECT * FROM trade_notes WHERE trade_id = $1 ORDER BY created_at',
      [req.params.id]
    );

    res.json({ ...rows[0], notes: notes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /trades — registrar nueva operativa
router.post('/',
  [
    body('wallet_id').isUUID(),
    body('symbol').trim().notEmpty().toUpperCase(),
    body('trade_type').isIn(['long','short','spot_buy','spot_sell']),
    body('entry_price').isFloat({ min: 0.000001 }),
    body('quantity').isFloat({ min: 0.000001 }),
    body('leverage').optional().isInt({ min: 1, max: 125 }),
    body('stop_loss').optional({ nullable: true }).isFloat({ min: 0 }),
    body('take_profit').optional({ nullable: true }).isFloat({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    const {
      wallet_id, symbol, trade_type, entry_price, quantity,
      leverage = 1, stop_loss, take_profit, exchange,
      timeframe, notes, tags, alert_id,
    } = req.body;

    try {
      const { rows } = await query(
        `INSERT INTO trades
          (wallet_id, symbol, trade_type, entry_price, quantity, leverage, stop_loss, take_profit,
           exchange, timeframe, notes, tags, alert_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          wallet_id, symbol, trade_type, entry_price, quantity,
          leverage, stop_loss || null, take_profit || null,
          exchange || 'binance', timeframe || null, notes || null,
          tags || null, alert_id || null,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /trades/:id/close — cerrar operativa
router.patch('/:id/close',
  [
    param('id').isUUID(),
    body('exit_price').isFloat({ min: 0.000001 }),
    body('fees').optional().isFloat({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    const { exit_price, fees = 0, notes } = req.body;

    try {
      // Obtener el trade
      const { rows: existing } = await query('SELECT * FROM trades WHERE id = $1', [req.params.id]);
      if (!existing.length) return res.status(404).json({ error: 'Trade no encontrado' });

      const trade = existing[0];
      if (trade.status === 'closed') return res.status(400).json({ error: 'El trade ya está cerrado' });

      // Calcular PnL
      const { pnl, pnl_pct } = calculatePnL(trade, exit_price, fees);

      const { rows } = await query(
        `UPDATE trades
         SET exit_price = $1, fees = $2, pnl = $3, pnl_percentage = $4,
             status = 'closed', closed_at = NOW(), updated_at = NOW()
         WHERE id = $5 RETURNING *`,
        [exit_price, fees, pnl, pnl_pct, req.params.id]
      );

      // Agregar nota si viene
      if (notes) {
        await query(
          'INSERT INTO trade_notes (trade_id, content, price_at) VALUES ($1, $2, $3)',
          [req.params.id, notes, exit_price]
        );
      }

      // Actualizar saldo de la wallet
      await query(
        'UPDATE wallets SET current_balance = current_balance + $1, updated_at = NOW() WHERE id = $2',
        [pnl - fees, trade.wallet_id]
      );

      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /trades/:id/analyze — análisis IA de trade cerrado
router.post('/:id/analyze', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM trades WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Trade no encontrado' });
    if (rows[0].status !== 'closed') return res.status(400).json({ error: 'Solo se pueden analizar trades cerrados' });

    const summary = await summarizeTrade(rows[0]);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /trades/:id/notes — agregar nota
router.post('/:id/notes',
  [body('content').trim().notEmpty()],
  validate,
  async (req, res) => {
    try {
      const { rows } = await query(
        'INSERT INTO trade_notes (trade_id, content, price_at) VALUES ($1, $2, $3) RETURNING *',
        [req.params.id, req.body.content, req.body.price_at || null]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /trades/:id — cancelar (sólo open)
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE trades SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'open' RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(400).json({ error: 'Trade no encontrado o no está abierto' });
    res.json({ cancelled: true, id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers ─────────────────────────────────────────────────────

function calculatePnL(trade, exitPrice, fees = 0) {
  const entry    = parseFloat(trade.entry_price);
  const exit     = parseFloat(exitPrice);
  const qty      = parseFloat(trade.quantity);
  const leverage = parseInt(trade.leverage) || 1;

  let pnl = 0;
  if (trade.trade_type === 'long' || trade.trade_type === 'spot_buy') {
    pnl = (exit - entry) * qty * leverage;
  } else {
    pnl = (entry - exit) * qty * leverage;
  }

  pnl -= parseFloat(fees);
  const invested = entry * qty;
  const pnl_pct = invested > 0 ? (pnl / invested) * 100 : 0;

  return { pnl, pnl_pct };
}

export default router;
