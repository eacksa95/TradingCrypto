/* ── Config ──────────────────────────────────────────────── */
const API = '/api';

/* ── State ───────────────────────────────────────────────── */
let activePage = 'dashboard';
let portfolioData = null;
let statsData = null;

/* ── Utils ───────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return '—';
  return parseFloat(n).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtMoney(n, dec = 2) {
  if (n == null || isNaN(n)) return '—';
  const v = parseFloat(n);
  const prefix = v >= 0 ? '+$' : '-$';
  return prefix + Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  const v = parseFloat(n);
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function timeAgo(d) {
  if (!d) return '—';
  const sec = Math.floor((Date.now() - new Date(d)) / 1000);
  if (sec < 60)    return `hace ${sec}s`;
  if (sec < 3600)  return `hace ${Math.floor(sec/60)}m`;
  if (sec < 86400) return `hace ${Math.floor(sec/3600)}h`;
  return `hace ${Math.floor(sec/86400)}d`;
}

async function apiFetch(path, opts = {}) {
  try {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return await res.json();
  } catch (err) {
    toast(err.message, 'error');
    throw err;
  }
}

function toast(msg, type = 'info') {
  const container = $('#toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function badgeRec(rec) {
  if (!rec) return '<span class="badge badge-gray">—</span>';
  const map = {
    LONG: 'badge-green', SHORT: 'badge-red', SPOT_BUY: 'badge-blue',
    SPOT_SELL: 'badge-yellow', HOLD: 'badge-gray', AVOID: 'badge-orange',
  };
  return `<span class="badge ${map[rec] || 'badge-gray'}">${rec}</span>`;
}

function badgeTrade(type) {
  const map = {
    long: 'badge-green', short: 'badge-red',
    spot_buy: 'badge-blue', spot_sell: 'badge-yellow',
  };
  return `<span class="badge ${map[type] || 'badge-gray'}">${type.replace('_',' ').toUpperCase()}</span>`;
}

function badgeStatus(s) {
  const map = { open: 'badge-blue', closed: 'badge-gray', cancelled: 'badge-orange' };
  return `<span class="badge ${map[s] || 'badge-gray'}">${s.toUpperCase()}</span>`;
}

/* ── Navigation ──────────────────────────────────────────── */
function navigate(page) {
  activePage = page;
  $$('.page').forEach(p => p.classList.remove('active'));
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  $(`#page-${page}`)?.classList.add('active');
  $(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  $('#topbar-title').textContent = { dashboard: 'Dashboard', wallets: 'Billeteras & Fondos', trades: 'Operativas', alerts: 'Alertas de TradingView', analysis: 'Análisis IA', market: 'Mercado' }[page] || page;
  loadPage(page);
}

async function loadPage(page) {
  if (page === 'dashboard') loadDashboard();
  else if (page === 'wallets')  loadWallets();
  else if (page === 'trades')   loadTrades();
  else if (page === 'alerts')   loadAlerts();
  else if (page === 'analysis') loadAnalysis();
  else if (page === 'market')   loadMarket();
}

/* ── Health check ────────────────────────────────────────── */
async function checkHealth() {
  try {
    await fetch('/health');
    $('#status-dot').classList.add('online');
    $('#status-text').textContent = 'Conectado';
  } catch {
    $('#status-dot').classList.remove('online');
    $('#status-text').textContent = 'Desconectado';
  }
}

/* ══════════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════════ */
async function loadDashboard() {
  try {
    const [portfolio, stats, alerts] = await Promise.all([
      apiFetch('/wallets/summary/portfolio').catch(() => null),
      apiFetch('/trades/stats/summary').catch(() => null),
      apiFetch('/alerts?limit=5').catch(() => []),
    ]);

    portfolioData = portfolio;
    statsData = stats;

    // Stats row
    const totalBalance = portfolio?.total_balance_usd ?? 0;
    const totalPnl     = stats?.total_pnl ?? 0;
    const winRate      = stats?.win_rate ?? 0;
    const openTrades   = stats?.open_trades ?? 0;

    $('#dash-balance').textContent    = '$' + fmt(totalBalance);
    $('#dash-pnl').textContent        = fmtMoney(totalPnl);
    $('#dash-pnl').className          = totalPnl >= 0 ? 'stat-value positive' : 'stat-value negative';
    $('#dash-winrate').textContent    = fmt(winRate) + '%';
    $('#dash-open').textContent       = openTrades;
    $('#dash-wallets').textContent    = portfolio?.total_wallets ?? 0;
    $('#dash-trades-total').textContent = stats?.total_trades ?? 0;

    // Alertas recientes
    renderAlertsPreview(Array.isArray(alerts) ? alerts.slice(0, 5) : []);

    // Wallets mini
    renderWalletsMini(portfolio?.wallets || []);

  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

function renderAlertsPreview(alerts) {
  const el = $('#dash-alerts-list');
  if (!alerts.length) {
    el.innerHTML = `<div class="empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><h3>Sin alertas aún</h3><p>Conectá TradingView para recibir señales</p></div>`;
    return;
  }
  el.innerHTML = alerts.map(a => {
    const iconClass = ['long','buy'].includes(a.action) ? 'long' : ['short','sell'].includes(a.action) ? 'short' : 'default';
    const iconText  = a.action.slice(0,1).toUpperCase();
    return `<div class="alert-item">
      <div class="alert-icon ${iconClass}">${iconText}</div>
      <div class="alert-meta">
        <div class="alert-symbol">${a.symbol} <small style="font-weight:400;color:var(--text2)">${a.timeframe || ''}</small></div>
        <div class="alert-detail">${a.strategy_name || a.indicator_name || '—'} · $${fmt(a.price, 4)}</div>
      </div>
      <div class="alert-rec">
        ${badgeRec(a.recommendation)}
        <div class="alert-time">${timeAgo(a.created_at)}</div>
      </div>
    </div>`;
  }).join('');
}

function renderWalletsMini(wallets) {
  const el = $('#dash-wallets-list');
  if (!wallets.length) {
    el.innerHTML = '<div class="empty"><h3>Sin billeteras</h3></div>';
    return;
  }
  el.innerHTML = wallets.map(w => `
    <div class="price-ticker" style="margin-bottom:8px">
      <div>
        <div class="ticker-symbol">${w.name}</div>
        <div style="font-size:11px;color:var(--text2)">${w.exchange}</div>
      </div>
      <div class="ticker-price">$${fmt(w.balance)}</div>
    </div>`).join('');
}

/* ══════════════════════════════════════════════════════════
   WALLETS
══════════════════════════════════════════════════════════ */
async function loadWallets() {
  const el = $('#wallets-grid');
  el.innerHTML = '<div class="loader"><span class="spin">⟳</span> Cargando...</div>';
  try {
    const wallets = await apiFetch('/wallets');
    renderWalletsGrid(wallets);
  } catch { el.innerHTML = '<div class="empty"><h3>Error cargando billeteras</h3></div>'; }
}

function renderWalletsGrid(wallets) {
  const el = $('#wallets-grid');
  if (!wallets.length) {
    el.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/><path d="M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 005 0"/></svg>
      <h3>No hay billeteras registradas</h3>
      <p>Agregá tu primera billetera usando el botón de arriba</p>
    </div>`;
    return;
  }

  el.innerHTML = wallets.map(w => {
    const bal = parseFloat(w.current_balance) || 0;
    const init = parseFloat(w.initial_balance) || 0;
    const diff = bal - init;
    const pct  = init > 0 ? (diff / init * 100) : 0;
    return `<div class="wallet-card">
      <div class="wallet-header">
        <div class="wallet-name">${w.name}</div>
        <div class="wallet-exchange">${w.exchange}${w.network ? ' · ' + w.network : ''}</div>
      </div>
      <div class="wallet-balance">$${fmt(bal)}</div>
      <div class="wallet-currency">${w.currency}</div>
      <div class="wallet-meta">
        <span>Inicial: $${fmt(init)}</span>
        <span class="${diff >= 0 ? 'positive' : 'negative'}">${fmtMoney(diff)} (${fmtPct(pct)})</span>
      </div>
      ${w.wallet_address ? `<div style="font-size:11px;color:var(--text2);margin-top:8px;word-break:break-all">${w.wallet_address}</div>` : ''}
    </div>`;
  }).join('');
}

/* ── New Wallet Modal ────────────────────────────────────── */
function openWalletModal() {
  $('#modal-wallet').classList.add('open');
}
function closeWalletModal() {
  $('#modal-wallet').classList.remove('open');
  $('#form-wallet').reset();
}

$('#form-wallet')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  try {
    await apiFetch('/wallets', { method: 'POST', body: JSON.stringify(data) });
    toast('Billetera creada', 'success');
    closeWalletModal();
    loadWallets();
  } catch {}
});

/* ══════════════════════════════════════════════════════════
   TRADES
══════════════════════════════════════════════════════════ */
async function loadTrades() {
  const el = $('#trades-table-body');
  el.innerHTML = '<tr><td colspan="9" class="loader">⟳ Cargando...</td></tr>';
  try {
    const { data } = await apiFetch('/trades?limit=100');
    renderTradesTable(data);
    loadTradesStats();
  } catch { el.innerHTML = '<tr><td colspan="9" class="empty">Error cargando operativas</td></tr>'; }
}

async function loadTradesStats() {
  try {
    const stats = await apiFetch('/trades/stats/summary');
    $('#ts-total').textContent  = stats.total_trades;
    $('#ts-open').textContent   = stats.open_trades;
    $('#ts-pnl').textContent    = fmtMoney(stats.total_pnl);
    $('#ts-pnl').className      = parseFloat(stats.total_pnl) >= 0 ? 'stat-value positive' : 'stat-value negative';
    $('#ts-wr').textContent     = fmt(stats.win_rate) + '%';
    $('#ts-best').textContent   = fmtMoney(stats.best_trade);
    $('#ts-worst').textContent  = fmtMoney(stats.worst_trade);
  } catch {}
}

function renderTradesTable(trades) {
  const el = $('#trades-table-body');
  if (!trades.length) {
    el.innerHTML = `<tr><td colspan="9"><div class="empty"><h3>Sin operativas</h3></div></td></tr>`;
    return;
  }
  el.innerHTML = trades.map(t => {
    const pnl = parseFloat(t.pnl);
    const pnlHtml = t.status === 'closed'
      ? `<span class="${pnl >= 0 ? 'positive' : 'negative'}">${fmtMoney(pnl)} (${fmtPct(t.pnl_percentage)})</span>`
      : '—';
    return `<tr>
      <td><strong>${t.symbol}</strong></td>
      <td>${badgeTrade(t.trade_type)}</td>
      <td>${badgeStatus(t.status)}</td>
      <td>$${fmt(t.entry_price, 4)}</td>
      <td>${t.exit_price ? '$' + fmt(t.exit_price, 4) : '—'}</td>
      <td>${fmt(t.quantity, 6)}</td>
      <td>${t.leverage > 1 ? t.leverage + 'x' : '—'}</td>
      <td>${pnlHtml}</td>
      <td>
        ${t.status === 'open' ? `<button class="btn btn-sm btn-ghost" onclick="openCloseTradeModal('${t.id}','${t.symbol}','${t.trade_type}')">Cerrar</button>` : ''}
        <small style="color:var(--text2)">${t.wallet_name}</small>
      </td>
    </tr>`;
  }).join('');
}

/* ── New Trade Modal ─────────────────────────────────────── */
async function openTradeModal() {
  // Cargar wallets para el select
  try {
    const wallets = await apiFetch('/wallets');
    const sel = $('#trade-wallet-select');
    sel.innerHTML = wallets.map(w => `<option value="${w.id}">${w.name} (${w.exchange})</option>`).join('');
  } catch {}
  $('#modal-trade').classList.add('open');
}
function closeTradeModal() {
  $('#modal-trade').classList.remove('open');
  $('#form-trade').reset();
}

$('#form-trade')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  try {
    await apiFetch('/trades', { method: 'POST', body: JSON.stringify(data) });
    toast('Operativa registrada', 'success');
    closeTradeModal();
    loadTrades();
  } catch {}
});

/* ── Close Trade Modal ───────────────────────────────────── */
let closingTradeId = null;
function openCloseTradeModal(id, symbol, type) {
  closingTradeId = id;
  $('#close-trade-info').textContent = `${type.toUpperCase()} ${symbol}`;
  $('#modal-close-trade').classList.add('open');
}
function closeCloseTradeModal() {
  $('#modal-close-trade').classList.remove('open');
  $('#form-close-trade').reset();
  closingTradeId = null;
}

$('#form-close-trade')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!closingTradeId) return;
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  try {
    await apiFetch(`/trades/${closingTradeId}/close`, { method: 'PATCH', body: JSON.stringify(data) });
    toast('Operativa cerrada', 'success');
    closeCloseTradeModal();
    loadTrades();
  } catch {}
});

/* ══════════════════════════════════════════════════════════
   ALERTS
══════════════════════════════════════════════════════════ */
async function loadAlerts() {
  const el = $('#alerts-list');
  el.innerHTML = '<div class="loader"><span class="spin">⟳</span> Cargando...</div>';
  try {
    const alerts = await apiFetch('/alerts?limit=50');
    renderAlertsList(alerts);
  } catch { el.innerHTML = '<div class="empty"><h3>Error</h3></div>'; }
}

function renderAlertsList(alerts) {
  const el = $('#alerts-list');
  if (!alerts.length) {
    el.innerHTML = `<div class="empty">
      <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
      <h3>Sin alertas</h3>
      <p>Cuando TradingView envíe señales aparecerán aquí</p>
      <p style="font-size:11px;margin-top:8px;background:var(--bg3);padding:8px 12px;border-radius:6px;font-family:monospace">POST ${location.origin}/api/alerts/webhook</p>
    </div>`;
    return;
  }

  el.innerHTML = alerts.map(a => {
    const iconClass = ['long','buy'].includes(a.action) ? 'long' : ['short','sell'].includes(a.action) ? 'short' : 'default';
    const hasRec = a.recommendation;
    return `<div class="analysis-card" style="cursor:pointer" onclick="showAlertDetail('${a.id}')">
      <div class="analysis-header">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="alert-icon ${iconClass}" style="width:32px;height:32px;font-size:12px">${a.action.slice(0,1).toUpperCase()}</div>
          <div>
            <span class="analysis-symbol">${a.symbol}</span>
            <span style="color:var(--text2);font-size:12px;margin-left:8px">${a.timeframe || ''}</span>
            <span class="badge badge-gray" style="margin-left:6px;font-size:11px">${a.action.toUpperCase()}</span>
          </div>
        </div>
        <div style="text-align:right">
          ${hasRec ? badgeRec(a.recommendation) : (a.is_processed ? '<span class="badge badge-gray">Procesado</span>' : '<span class="badge badge-yellow">Analizando...</span>')}
          <div class="alert-time">${timeAgo(a.created_at)}</div>
        </div>
      </div>
      ${a.reasoning ? `<div class="analysis-reasoning">${a.reasoning}</div>` : ''}
      ${hasRec ? `<div class="analysis-levels">
        ${a.confidence ? `<div class="level-item"><span class="level-label">Confianza: </span><span class="level-value">${a.confidence}%</span></div>` : ''}
        ${a.risk_level ? `<div class="level-item"><span class="level-label">Riesgo: </span><span class="level-value">${a.risk_level}</span></div>` : ''}
        ${a.suggested_entry ? `<div class="level-item"><span class="level-label">Entrada: </span><span class="level-value">$${fmt(a.suggested_entry, 4)}</span></div>` : ''}
        ${a.suggested_sl ? `<div class="level-item"><span class="level-label">SL: </span><span class="level-value negative">$${fmt(a.suggested_sl, 4)}</span></div>` : ''}
        ${a.suggested_tp1 ? `<div class="level-item"><span class="level-label">TP1: </span><span class="level-value positive">$${fmt(a.suggested_tp1, 4)}</span></div>` : ''}
        ${a.suggested_tp2 ? `<div class="level-item"><span class="level-label">TP2: </span><span class="level-value positive">$${fmt(a.suggested_tp2, 4)}</span></div>` : ''}
        <div class="level-item" style="margin-left:auto">
          <span style="color:var(--text2);font-size:11px">$${fmt(a.price, 4)}</span>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');
}

async function showAlertDetail(id) {
  try {
    const a = await apiFetch(`/alerts/${id}`);
    const an = a.analysis;
    $('#alert-detail-title').textContent = `${a.symbol} — ${a.action.toUpperCase()}`;
    $('#alert-detail-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div class="stat-card"><div class="stat-label">Precio</div><div class="stat-value" style="font-size:18px">$${fmt(a.price, 4)}</div></div>
        <div class="stat-card"><div class="stat-label">Estrategia</div><div class="stat-value" style="font-size:15px">${a.strategy_name || '—'}</div></div>
      </div>
      ${an ? `
      <div class="card" style="margin-bottom:12px">
        <div class="card-title">Análisis IA <span style="font-size:11px;font-weight:400">${an.ai_input_tokens ? '🪙 ' + an.ai_input_tokens + ' tokens' : ''}</span></div>
        <div style="margin-bottom:12px">${badgeRec(an.recommendation)} <span style="margin-left:8px">Confianza: <strong>${an.confidence}%</strong></span> <span style="margin-left:8px">Riesgo: <strong>${an.risk_level}</strong></span></div>
        <div style="color:var(--text2);font-size:13px;line-height:1.6">${an.reasoning || '—'}</div>
        ${an.suggested_entry ? `<div class="analysis-levels" style="margin-top:12px">
          <div class="level-item"><span class="level-label">Entrada: </span><span class="level-value">$${fmt(an.suggested_entry, 4)}</span></div>
          <div class="level-item"><span class="level-label">SL: </span><span class="level-value negative">$${fmt(an.suggested_sl, 4)}</span></div>
          <div class="level-item"><span class="level-label">TP1: </span><span class="level-value positive">$${fmt(an.suggested_tp1, 4)}</span></div>
          <div class="level-item"><span class="level-label">TP2: </span><span class="level-value positive">$${fmt(an.suggested_tp2, 4)}</span></div>
        </div>` : ''}
      </div>` : '<div class="empty" style="padding:24px"><h3>Sin análisis IA aún</h3></div>'}
      <div style="font-size:11px;color:var(--text2)">${fmtDate(a.created_at)}</div>
    `;
    $('#modal-alert-detail').classList.add('open');
  } catch {}
}

/* ══════════════════════════════════════════════════════════
   ANALYSIS
══════════════════════════════════════════════════════════ */
async function loadAnalysis() {
  const el = $('#analysis-list');
  el.innerHTML = '<div class="loader"><span class="spin">⟳</span> Cargando...</div>';
  try {
    const items = await apiFetch('/analysis?limit=20');
    renderAnalysisList(items);
  } catch { el.innerHTML = '<div class="empty"><h3>Error</h3></div>'; }
}

function renderAnalysisList(items) {
  const el = $('#analysis-list');
  if (!items.length) {
    el.innerHTML = `<div class="empty"><h3>Sin análisis</h3><p>Los análisis aparecen automáticamente cuando llegan alertas de TradingView</p></div>`;
    return;
  }
  el.innerHTML = items.map(a => `
    <div class="analysis-card">
      <div class="analysis-header">
        <div>
          <span class="analysis-symbol">${a.symbol}</span>
          <span style="color:var(--text2);font-size:12px;margin-left:6px">${a.timeframe || ''}</span>
        </div>
        <div style="text-align:right">
          ${badgeRec(a.recommendation)}
          <div class="alert-time">${timeAgo(a.created_at)}</div>
        </div>
      </div>
      <div class="analysis-reasoning">${a.reasoning || '—'}</div>
      <div class="analysis-levels">
        ${a.confidence ? `<div class="level-item"><span class="level-label">Confianza: </span><span class="level-value">${a.confidence}%</span></div>` : ''}
        ${a.risk_level ? `<div class="level-item"><span class="level-label">Riesgo: </span><span class="level-value">${a.risk_level}</span></div>` : ''}
        ${a.suggested_entry ? `<div class="level-item"><span class="level-label">Entrada: </span><span class="level-value">$${fmt(a.suggested_entry,4)}</span></div>` : ''}
        ${a.suggested_sl  ? `<div class="level-item"><span class="level-label">SL: </span><span class="level-value negative">$${fmt(a.suggested_sl,4)}</span></div>` : ''}
        ${a.suggested_tp1 ? `<div class="level-item"><span class="level-label">TP1: </span><span class="level-value positive">$${fmt(a.suggested_tp1,4)}</span></div>` : ''}
        ${a.suggested_tp2 ? `<div class="level-item"><span class="level-label">TP2: </span><span class="level-value positive">$${fmt(a.suggested_tp2,4)}</span></div>` : ''}
      </div>
    </div>`).join('');
}

/* ── Manual Analysis ─────────────────────────────────────── */
async function runManualAnalysis() {
  const symbol = $('#manual-symbol').value.trim().toUpperCase();
  const timeframe = $('#manual-tf').value;
  if (!symbol) return toast('Ingresá un símbolo', 'error');

  const btn = $('#btn-manual-analysis');
  btn.disabled = true;
  btn.textContent = '⟳ Analizando con Claude...';

  try {
    const result = await apiFetch('/analysis/manual', {
      method: 'POST',
      body: JSON.stringify({ symbol, timeframe }),
    });
    toast(`Análisis completado: ${result.recommendation}`, 'success');
    loadAnalysis();
  } catch {
    btn.disabled = false;
    btn.textContent = 'Analizar con Claude';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analizar con Claude';
  }
}

/* ══════════════════════════════════════════════════════════
   MARKET
══════════════════════════════════════════════════════════ */
const TRACKED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT'];

async function loadMarket() {
  const el = $('#market-grid');
  el.innerHTML = '<div class="loader" style="grid-column:1/-1"><span class="spin">⟳</span> Cargando precios...</div>';

  const results = await Promise.allSettled(
    TRACKED_SYMBOLS.map(s => apiFetch(`/market/ticker/${s}`))
  );

  el.innerHTML = results.map((r, i) => {
    const s = TRACKED_SYMBOLS[i];
    if (r.status !== 'fulfilled') {
      return `<div class="price-ticker"><div><div class="ticker-symbol">${s}</div></div><div class="neutral">—</div></div>`;
    }
    const t = r.value;
    const pct = parseFloat(t.priceChangePercent);
    return `<div class="price-ticker">
      <div>
        <div class="ticker-symbol">${t.symbol}</div>
        <div style="font-size:11px;color:var(--text2)">Vol: $${(parseFloat(t.quoteVolume)/1e6).toFixed(1)}M</div>
      </div>
      <div style="text-align:right">
        <div class="ticker-price">$${parseFloat(t.lastPrice).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:4})}</div>
        <div class="ticker-change ${pct >= 0 ? 'positive' : 'negative'}">${fmtPct(pct)}</div>
      </div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Navigation
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });

  // Modal close on overlay click
  $$('.modal-overlay').forEach(m => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); });
  });

  // Health check
  checkHealth();
  setInterval(checkHealth, 30000);

  // Auto-refresh alerts every 30s when on alerts page
  setInterval(() => {
    if (activePage === 'alerts')   loadAlerts();
    if (activePage === 'market')   loadMarket();
    if (activePage === 'dashboard') loadDashboard();
  }, 30000);

  // Start on dashboard
  navigate('dashboard');
});
