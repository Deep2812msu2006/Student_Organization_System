/**
 * server/model/finance.model.js — Deep owns this file.
 *
 * Financial reporting queries, receipts aggregation, expense ledger analysis,
 * and net recorded cash movement.
 *
 * Design constraints:
 *  - Parameterized queries ONLY ($1, $2, ...).
 *  - Accepts `db` (pg.Pool or pg.PoolClient).
 *  - Exact money represented as integer minor units (paise/cents).
 *  - Multi-currency separation: Never sum amounts across different currencies.
 *
 * Invariants:
 *  - @rule:ACTUAL_PAYMENTS_ONLY: Receipts reflect durable payment_records evidence only.
 *    Pending amounts, unpaid orders, and dues waivers are never counted as received money.
 *  - @rule:RECORDED_CASH_MOVEMENT: Net cash movement is defined as:
 *    `totalReceiptsMinor - reimbursedExpensesMinor`.
 *    It is NOT described as an audited bank balance because opening balances and
 *    untracked external fees/taxes are not stored in this ledger.
 *  - @rule:LIABILITY_DISTINCTION: Approved-but-unpaid expenses are tracked as committed
 *    liabilities, not money paid out.
 */

/**
 * Generate a comprehensive financial summary aggregated strictly per currency.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{
 *   from?: string | null,
 *   to?: string | null
 * }} [filter] Optional ISO timestamp boundary filter
 * @returns {Promise<{
 *   period: { from: string | null, to: string | null },
 *   currencies: Array<{
 *     currency: string,
 *     receipts: {
 *       duesMinor: number,
 *       duesCount: number,
 *       eventsMinor: number,
 *       eventsCount: number,
 *       merchandiseMinor: number,
 *       merchandiseCount: number,
 *       totalMinor: number,
 *       totalCount: number
 *     },
 *     disbursements: {
 *       reimbursedMinor: number,
 *       reimbursedCount: number
 *     },
 *     netCashMovementMinor: number,
 *     committedLiabilities: {
 *       approvedUnpaidMinor: number,
 *       approvedUnpaidCount: number
 *     },
 *     uncollected: {
 *       pendingDuesMinor: number,
 *       pendingDuesCount: number,
 *       waivedDuesMinor: number,
 *       waivedDuesCount: number
 *     }
 *   }>,
 *   notice: string
 * }>}
 */
export async function getFinancialSummary(db, { from = null, to = null } = {}) {
  // 1. Query receipts by source breakdown and currency
  const { rows: receiptRows } = await db.query(
    `SELECT
       currency,
       COALESCE(SUM(amount_minor) FILTER (WHERE dues_obligation_id IS NOT NULL), 0)::bigint AS "duesMinor",
       COUNT(*) FILTER (WHERE dues_obligation_id IS NOT NULL)::int AS "duesCount",
       COALESCE(SUM(amount_minor) FILTER (WHERE registration_id IS NOT NULL), 0)::bigint AS "eventsMinor",
       COUNT(*) FILTER (WHERE registration_id IS NOT NULL)::int AS "eventsCount",
       COALESCE(SUM(amount_minor) FILTER (WHERE order_id IS NOT NULL), 0)::bigint AS "merchandiseMinor",
       COUNT(*) FILTER (WHERE order_id IS NOT NULL)::int AS "merchandiseCount",
       COALESCE(SUM(amount_minor), 0)::bigint AS "totalMinor",
       COUNT(*)::int AS "totalCount"
     FROM payment_records
     WHERE ($1::timestamptz IS NULL OR created_at >= $1)
       AND ($2::timestamptz IS NULL OR created_at <= $2)
     GROUP BY currency
     ORDER BY currency ASC`,
    [from, to]
  );

  // 2. Query expenses breakdown by currency
  const { rows: expenseRows } = await db.query(
    `SELECT
       currency,
       COALESCE(SUM(amount_minor) FILTER (WHERE status = 'reimbursed'), 0)::bigint AS "reimbursedMinor",
       COUNT(*) FILTER (WHERE status = 'reimbursed')::int AS "reimbursedCount",
       COALESCE(SUM(amount_minor) FILTER (WHERE status = 'approved'), 0)::bigint AS "approvedUnpaidMinor",
       COUNT(*) FILTER (WHERE status = 'approved')::int AS "approvedUnpaidCount",
       COALESCE(SUM(amount_minor) FILTER (WHERE status = 'submitted'), 0)::bigint AS "submittedMinor",
       COUNT(*) FILTER (WHERE status = 'submitted')::int AS "submittedCount",
       COALESCE(SUM(amount_minor) FILTER (WHERE status = 'rejected'), 0)::bigint AS "rejectedMinor",
       COUNT(*) FILTER (WHERE status = 'rejected')::int AS "rejectedCount"
     FROM expenses
     WHERE ($1::timestamptz IS NULL OR created_at >= $1)
       AND ($2::timestamptz IS NULL OR created_at <= $2)
     GROUP BY currency
     ORDER BY currency ASC`,
    [from, to]
  );

  // 3. Query uncollected dues obligations (pending vs waived) by currency
  const { rows: duesRows } = await db.query(
    `SELECT
       currency,
       COALESCE(SUM(amount_minor) FILTER (WHERE status = 'pending'), 0)::bigint AS "pendingDuesMinor",
       COUNT(*) FILTER (WHERE status = 'pending')::int AS "pendingDuesCount",
       COALESCE(SUM(amount_minor) FILTER (WHERE status = 'waived'), 0)::bigint AS "waivedDuesMinor",
       COUNT(*) FILTER (WHERE status = 'waived')::int AS "waivedDuesCount"
     FROM dues_obligations
     WHERE ($1::timestamptz IS NULL OR created_at >= $1)
       AND ($2::timestamptz IS NULL OR created_at <= $2)
     GROUP BY currency
     ORDER BY currency ASC`,
    [from, to]
  );

  // 4. Collect all distinct currencies across all queries
  const currencySet = new Set([
    ...receiptRows.map(r => r.currency),
    ...expenseRows.map(r => r.currency),
    ...duesRows.map(r => r.currency),
  ]);

  // Default to INR if database has no records yet
  if (currencySet.size === 0) {
    currencySet.add('INR');
  }

  const receiptMap = new Map(receiptRows.map(r => [r.currency, r]));
  const expenseMap = new Map(expenseRows.map(r => [r.currency, r]));
  const duesMap = new Map(duesRows.map(r => [r.currency, r]));

  const currencies = Array.from(currencySet).sort().map(curr => {
    const r = receiptMap.get(curr) || {
      duesMinor: '0', duesCount: 0,
      eventsMinor: '0', eventsCount: 0,
      merchandiseMinor: '0', merchandiseCount: 0,
      totalMinor: '0', totalCount: 0,
    };
    const e = expenseMap.get(curr) || {
      reimbursedMinor: '0', reimbursedCount: 0,
      approvedUnpaidMinor: '0', approvedUnpaidCount: 0,
      submittedMinor: '0', submittedCount: 0,
      rejectedMinor: '0', rejectedCount: 0,
    };
    const d = duesMap.get(curr) || {
      pendingDuesMinor: '0', pendingDuesCount: 0,
      waivedDuesMinor: '0', waivedDuesCount: 0,
    };

    const totalReceiptsMinor = parseInt(r.totalMinor, 10);
    const reimbursedMinor = parseInt(e.reimbursedMinor, 10);
    const netCashMovementMinor = totalReceiptsMinor - reimbursedMinor;

    return {
      currency: curr,
      receipts: {
        duesMinor: parseInt(r.duesMinor, 10),
        duesCount: r.duesCount,
        eventsMinor: parseInt(r.eventsMinor, 10),
        eventsCount: r.eventsCount,
        merchandiseMinor: parseInt(r.merchandiseMinor, 10),
        merchandiseCount: r.merchandiseCount,
        totalMinor: totalReceiptsMinor,
        totalCount: r.totalCount,
      },
      disbursements: {
        reimbursedMinor,
        reimbursedCount: e.reimbursedCount,
      },
      netCashMovementMinor,
      committedLiabilities: {
        approvedUnpaidMinor: parseInt(e.approvedUnpaidMinor, 10),
        approvedUnpaidCount: e.approvedUnpaidCount,
      },
      uncollected: {
        pendingDuesMinor: parseInt(d.pendingDuesMinor, 10),
        pendingDuesCount: d.pendingDuesCount,
        waivedDuesMinor: parseInt(d.waivedDuesMinor, 10),
        waivedDuesCount: d.waivedDuesCount,
      },
    };
  });

  return {
    period: { from, to },
    currencies,
    notice: 'Net cash movement represents recorded income minus reimbursed expenses. It is not an audited bank balance.',
  };
}
