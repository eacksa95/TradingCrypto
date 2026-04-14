import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import { query } from '../config/database.js';

const router = Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// GET /wallets — listar todas
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT w.*,
        COALESCE(
          (SELECT SUM(amount) FILTER (WHERE type IN ('deposit','transfer_in','profit'))
           FROM wallet_transactions WHERE wallet_id = w.id), 0
        ) -
        COALESCE(
          (SELECT SUM(amount) FILTER (WHERE type IN ('withdrawal','transfer_out','loss','fee'))
           FROM wallet_transactions WHERE wallet_id = w.id), 0
        ) AS calculated_balance
      FROM wallets w
      ORDER BY w.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /wallets/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM wallets WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Wallet no encontrada' });

    // Historial de transacciones
    const txResult = await query(
      'SELECT * FROM wallet_transactions WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.params.id]
    );

    res.json({ ...rows[0], transactions: txResult.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /wallets — crear
router.post('/',
  [
    body('name').trim().notEmpty().withMessage('El nombre es requerido'),
    body('exchange').trim().notEmpty().withMessage('El exchange es requerido'),
    body('currency').trim().notEmpty().withMessage('La moneda es requerida'),
    body('initial_balance').optional().isFloat({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    const { name, exchange, network, wallet_address, currency, initial_balance = 0, notes } = req.body;
    try {
      const { rows } = await query(
        `INSERT INTO wallets (name, exchange, network, wallet_address, currency, initial_balance, current_balance, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7) RETURNING *`,
        [name, exchange, network || null, wallet_address || null, currency, initial_balance, notes || null]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /wallets/:id — actualizar saldo o datos
router.patch('/:id',
  [
    param('id').isUUID(),
    body('current_balance').optional().isFloat({ min: 0 }),
    body('name').optional().trim().notEmpty(),
  ],
  validate,
  async (req, res) => {
    const allowed = ['name', 'exchange', 'network', 'wallet_address', 'currency', 'current_balance', 'is_active', 'notes'];
    const updates = [];
    const values = [];
    let i = 1;

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = $${i++}`);
        values.push(req.body[key]);
      }
    }

    if (!updates.length) return res.status(400).json({ error: 'No hay campos para actualizar' });

    values.push(req.params.id);
    try {
      const { rows } = await query(
        `UPDATE wallets SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
        values
      );
      if (!rows.length) return res.status(404).json({ error: 'Wallet no encontrada' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /wallets/:id/transactions — registrar movimiento
router.post('/:id/transactions',
  [
    param('id').isUUID(),
    body('type').isIn(['deposit','withdrawal','transfer_in','transfer_out','fee','profit','loss']),
    body('amount').isFloat({ min: 0.00000001 }),
    body('currency').trim().notEmpty(),
  ],
  validate,
  async (req, res) => {
    const { type, amount, currency, description, tx_hash } = req.body;
    try {
      // Verificar que existe la wallet
      const wallet = await query('SELECT id FROM wallets WHERE id = $1', [req.params.id]);
      if (!wallet.rows.length) return res.status(404).json({ error: 'Wallet no encontrada' });

      const { rows } = await query(
        `INSERT INTO wallet_transactions (wallet_id, type, amount, currency, description, tx_hash)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.params.id, type, amount, currency, description || null, tx_hash || null]
      );

      // Actualizar saldo en la wallet
      const sign = ['deposit','transfer_in','profit'].includes(type) ? '+' : '-';
      await query(
        `UPDATE wallets SET current_balance = current_balance ${sign} $1, updated_at = NOW() WHERE id = $2`,
        [amount, req.params.id]
      );

      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /wallets/summary/portfolio — resumen global
router.get('/summary/portfolio', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*) AS total_wallets,
        SUM(current_balance) AS total_balance_usd,
        json_agg(json_build_object(
          'id', id, 'name', name, 'exchange', exchange,
          'currency', currency, 'balance', current_balance
        ) ORDER BY current_balance DESC) AS wallets
      FROM wallets
      WHERE is_active = TRUE
    `);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
