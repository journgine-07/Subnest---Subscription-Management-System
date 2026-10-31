import React, { useEffect, useState } from 'react';
import { AlertTriangle, CircleDollarSign, CreditCard, RefreshCw, Search, TrendingUp, Wallet } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api, date, money } from '../api';
import { Button, DataTable, Empty, Field, Kpi, PageHead, Status, TextInput } from '../ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortMoney = v => `₹${v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`;

function RevenueChart({ rows, label }) {
  if (!rows.length) return <Empty>No payments in this period yet.</Empty>;
  return <ResponsiveContainer width="100%" height="100%">
    <BarChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef1f5" />
      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#5b6578', fontSize: 12 }} />
      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#5b6578', fontSize: 12 }} tickFormatter={shortMoney} />
      <Tooltip formatter={v => [money(v), label]} />
      <Bar dataKey="amount" fill="#4668f5" radius={[6, 6, 0, 0]} maxBarSize={42} />
    </BarChart>
  </ResponsiveContainer>;
}

export function Dashboard({ notify }) {
  const [d, setD] = useState(null), [err, setErr] = useState('');
  const load = () => api('/dashboard').then(x => { setD(x); setErr(''); }).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (err) return <div className="notice" role="alert">{err}</div>;
  if (!d) return <div className="loading">Loading dashboard…</div>;
  const hour = new Date().getHours();
  const chart = (d.monthly || []).map(x => ({ label: MONTHS[x._id.month - 1], amount: x.amount }));
  return <>
    <PageHead eyebrow="BUSINESS OVERVIEW" title={hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'} description="Here is what is happening across your subscription business."
      action={<Button variant="secondary" onClick={() => { load(); notify('Dashboard refreshed'); }}><RefreshCw size={15} /> Refresh</Button>} />
    <div className="kpi-grid">
      <Kpi title="Active subscriptions" value={d.activeSubscriptions} icon={<RefreshCw />} tone="blue" note="Currently running" />
      <Kpi title="Monthly recurring revenue" value={money(d.monthlyRecurringRevenue)} icon={<TrendingUp />} tone="purple" note="Active plans, before tax & discounts" />
      <Kpi title="Collected this month" value={money(d.revenueThisMonth)} icon={<CircleDollarSign />} tone="green" note="Payments received" />
      <Kpi title="Outstanding balance" value={money(d.outstanding)} icon={<Wallet />} tone="orange" note={`${d.outstandingCount} confirmed invoice(s) unpaid`} />
      <Kpi title="Overdue" value={money(d.overdueAmount)} icon={<AlertTriangle />} tone="red" note={`${d.overdueCount} invoice(s) past due date`} />
    </div>
    <div className="dashboard-grid">
      <section className="panel chart-panel"><div className="panel-head"><div><h3>Revenue collected</h3><p>Payments received over the last 6 months</p></div><span className="panel-tag">6 MONTHS</span></div><div className="chart-area"><RevenueChart rows={chart} label="Collected" /></div></section>
      <section className="panel"><div className="panel-head"><div><h3>Recent payments</h3><p>Latest customer transactions</p></div></div>
        <div className="mini-list">{d.recentPayments?.length ? d.recentPayments.map(p => <div className="mini-row" key={p._id}><div className="mini-icon" aria-hidden="true"><CreditCard size={16} /></div><div className="mini-main"><b>{p.customer?.name || 'Customer'}</b><small>{p.invoice?.number || 'Invoice'} · {p.method}</small></div><div className="mini-amount">{money(p.amount)}<small>{date(p.date)}</small></div></div>) : <Empty>No payments yet.</Empty>}</div></section>
    </div>
    <section className="panel table-panel"><div className="panel-head"><div><h3>Overdue invoices</h3><p>Oldest first — the ones to chase today</p></div><span className="count-pill">{d.overdueCount} overdue</span></div>
      <DataTable caption="Overdue invoices" empty="No overdue invoices. Great work!" rows={d.overdueInvoices || []} columns={[
        { key: 'number', label: 'Invoice' }, { key: 'customer', label: 'Customer', render: r => r.customer?.name || '—' },
        { key: 'dueDate', label: 'Due date', render: r => date(r.dueDate) }, { key: 'total', label: 'Invoice total', render: r => money(r.total) },
        { key: 'outstanding', label: 'Outstanding', render: r => money(r.outstanding) }, { key: 'status', label: 'Status', render: () => <Status>Overdue</Status> }]} />
    </section>
  </>;
}

export function Reports({ notify }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`), [to, setTo] = useState(today), [r, setR] = useState(null), [busy, setBusy] = useState(false);
  const load = async () => {
    if (from > to) return notify('The "from" date must be before the "to" date.');
    setBusy(true);
    try { setR(await api(`/dashboard/reports?from=${from}&to=${to}`)); } catch (e) { notify(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const chart = (r?.payments || []).map(p => ({ label: `${MONTHS[p._id.month - 1]} ${String(p._id.year).slice(2)}`, amount: p.amount }));
  return <>
    <PageHead eyebrow="BUSINESS INTELLIGENCE" title="Reports & analytics" description="Collected revenue, invoices and subscriptions for a selected period." />
    <section className="panel form-panel"><form className="form-grid three" onSubmit={e => { e.preventDefault(); load(); }}>
      <Field label="From"><TextInput type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label="To"><TextInput type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></Field>
      <div className="form-actions"><Button disabled={busy}><Search size={15} /> {busy ? 'Loading…' : 'Apply filters'}</Button></div>
    </form></section>
    {r && <>
      <div className="kpi-grid">
        <Kpi title="Money collected" value={money(r.collected)} icon={<CircleDollarSign />} tone="green" note="Payments dated in this period" />
        <Kpi title="Invoiced" value={money(r.invoiced)} icon={<Wallet />} tone="blue" note="Invoices created, excluding cancelled" />
      </div>
      <div className="reports-grid">
        <section className="panel"><div className="panel-head"><div><h3>Collected revenue</h3><p>Payment totals by month</p></div></div><div className="chart-area tall"><RevenueChart rows={chart} label="Collected" /></div></section>
        <section className="panel"><div className="panel-head"><div><h3>By payment method</h3><p>Where the money came from</p></div></div>
          <DataTable caption="Payments by method" empty="No payments in this period." rows={r.byMethod || []} columns={[{ key: '_id', label: 'Method' }, { key: 'count', label: 'Payments' }, { key: 'amount', label: 'Amount', render: x => money(x.amount) }]} /></section>
        <section className="panel"><div className="panel-head"><div><h3>Invoice summary</h3><p>Count and value by status</p></div></div>
          <DataTable caption="Invoices by status" rows={r.invoices || []} columns={[{ key: '_id', label: 'Status' }, { key: 'count', label: 'Count' }, { key: 'total', label: 'Total', render: x => money(x.total) }]} /></section>
        <section className="panel"><div className="panel-head"><div><h3>Subscription summary</h3><p>Subscriptions created in this period, by status</p></div></div>
          <DataTable caption="Subscriptions by status" rows={r.subscriptions || []} columns={[{ key: '_id', label: 'Status' }, { key: 'count', label: 'Subscriptions' }]} /></section>
      </div>
    </>}
  </>;
}
