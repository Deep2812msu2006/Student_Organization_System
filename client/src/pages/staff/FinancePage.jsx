import {useResource} from '../../hooks/useResource.js';
import {money} from '../../utils/format.js';
import ModulePanel from '../../components/ModulePanel.jsx';
// @edit:FINANCE_CARDS — currencies remain separate; this is recorded movement, not a bank balance.
export default function FinancePage(){const r=useResource('/finance/summary');
 return <ModulePanel title="Financial summary" description="All-time recorded income and reimbursements, separated by currency." resource={r}>
 <button className="button button-secondary" onClick={r.reload}>Refresh summary</button>
 {r.data?.data.currencies.map(c=><article className="form-card" key={c.currency}><h2>{c.currency}</h2><dl className="finance-values">
 {Object.entries({'Membership dues received':c.receipts.duesMinor,'Event payments received':c.receipts.eventsMinor,'Merchandise payments received':c.receipts.merchandiseMinor,'Total receipts':c.receipts.totalMinor,'Expenses reimbursed':c.disbursements.reimbursedMinor,'Net recorded movement':c.netCashMovementMinor,'Approved expenses awaiting reimbursement':c.committedLiabilities.approvedUnpaidMinor,'Unpaid dues':c.uncollected.pendingDuesMinor}).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{money(value,c.currency)}</dd></div>)}
 </dl></article>)}<p className="muted">{r.data?.data.notice}</p></ModulePanel>;
}
