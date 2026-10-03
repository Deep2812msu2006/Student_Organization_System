import * as financeModel from '../model/finance.model.js';

/**
 * server/services/finance.service.js — Dharmik owns this file.
 *
 * Financial reporting service aggregating revenue, disbursements, liabilities,
 * and net recorded movement separated strictly per currency.
 */
export async function getFinancialSummary(pool, { from = null, to = null } = {}) {
  const summary = await financeModel.getFinancialSummary(pool, {
    from: from || null,
    to: to || null,
  });

  return summary;
}
