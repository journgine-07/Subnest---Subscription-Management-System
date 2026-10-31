import React, { useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { api, date, money } from '../api';
import { Button, DataTable, Field, PageHead, Pager, Select, Status, TextInput, esc, useLoad } from '../ui';

const TABS = [['', 'All'], ['Draft', 'Draft'], ['Confirmed', 'Outstanding'], ['overdue', 'Overdue'], ['Paid', 'Paid'], ['Cancelled', 'Cancelled']];

function printInvoice(r) {
  const w = window.open('', '_blank', 'width=800,height=700');
  if (!w) return;
  const rows = (r.lines || []).map(l => `<tr><td>${esc(l.description)}</td><td>${esc(l.quantity)}</td><td>${money(l.unitPrice)}</td><td>${esc(l.taxRate)}%</td><td>${money(l.amount)}</td></tr>`).join('');
  w.document.write(`<html><head><title>${esc(r.number)}</title><style>body{font-family:Arial;padding:40px;color:#222}h1{margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}.total{text-align:right;font-size:20px;font-weight:bold;margin-top:24px}</style></head><body>
<h1>Brightloop Software</h1><p>Invoice ${esc(r.number)} · ${esc(r.status)}</p><hr/>
<p>Customer: ${esc(r.customer?.name)} (${esc(r.customer?.email)})</p><p>Subscription: ${esc(r.subscription?.number)} · Period ${date(r.periodStart)} – ${date(r.periodEnd)}</p><p>Due: ${date(r.dueDate)}</p>
<table><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Tax</th><th>Amount</th></tr>${rows}</table>
<p>Subtotal: ${money(r.subtotal)}</p><p>Discount${r.discountName ? ` (${esc(r.discountName)})` : ''}: ${money(r.discountTotal)}</p><p>Tax: ${money(r.taxTotal)}</p>
<div class="total">Total: ${money(r.total)}</div><p>Paid: ${money(r.paidAmount)} · Outstanding: ${money(r.outstanding)}</p>
<script>window.print()<\/script></body></html>`);
  w.document.close();
}

export function Invoices({ user, notify }) {
  const isCustomer = user.role === 'customer';
  const [tab, setTab] = useState(''), [page, setPage] = useState(1), [q, setQ] = useState(''), [search, setSearch] = useState(''), [busy, setBusy] = useState(false);
  const params = new URLSearchParams({ page, limit: 20 });
  if (tab === 'overdue') params.set('overdue', '1'); else if (tab) params.set('status', tab);
  if (search) params.set('q', search);
  const { data, meta, loading, error, reload } = useLoad(`/billing/invoices?${params}`);

  const run = async () => {
    setBusy(true);
    try {
      const r = await api('/billing/run-due', { method: 'POST', body: {} });
      notify(`Billing run: ${r.invoicesCreated} created, ${r.alreadyBilled} already billed, ${r.subscriptionsClosed} closed${r.errors ? `, ${r.errors} errors (see server log)` : ''}`);
      reload();
    } catch (e) { notify(e.message); } finally { setBusy(false); }
  };
  const change = async (id, status) => {
    if (status === 'Cancelled' && !window.confirm('Cancel this invoice?')) return;
    try { await api(`/billing/invoices/${id}/status`, { method: 'PATCH', body: { status } }); notify(`Invoice ${status.toLowerCase()}`); reload(); }
    catch (e) { notify(e.message); }
  };
  const send = async id => { try { notify((await api(`/billing/invoices/${id}/send`, { method: 'POST', body: {} })).message); reload(); } catch (e) { notify(e.message); } };
  const tabs = TABS.filter(([k]) => !isCustomer || ['', 'Confirmed', 'overdue', 'Paid'].includes(k));

  return <>
    <PageHead eyebrow="BILLING" title="Invoices" description="Invoices are created from active subscriptions, then confirmed, sent and paid."
      action={!isCustomer && <Button onClick={run} disabled={busy}><RefreshCw size={15} />{busy ? 'Running…' : 'Run due billing'}</Button>} />
    <section className="panel table-panel">
      <div className="panel-head"><div><h3>Invoice register</h3><p>Outstanding = confirmed and not fully paid. Overdue = outstanding and past the due date.</p></div><span className="count-pill">{meta?.total ?? data.length} invoices</span></div>
      <div className="tabs" role="tablist" aria-label="Invoice status">
        {tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'tab active' : 'tab'} onClick={() => { setTab(key); setPage(1); }}>{label}</button>)}
      </div>
      <form className="toolbar" role="search" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(q.trim()); }}>
        <TextInput aria-label="Search by invoice number" placeholder="Invoice number, e.g. INV-0000" value={q} onChange={e => setQ(e.target.value)} />
        <Button variant="secondary">Search</Button>
      </form>
      {error && <div className="notice" role="alert">{error}</div>}
      {loading ? <div className="loading">Loading invoices…</div> :
        <DataTable caption="Invoices" rows={data} empty="No invoices match this view." columns={[
          { key: 'number', label: 'Invoice' },
          ...(isCustomer ? [] : [{ key: 'customer', label: 'Customer', render: r => r.customer?.name || '—' }]),
          { key: 'subscription', label: 'Subscription', render: r => r.subscription?.number || '—' },
          { key: 'dueDate', label: 'Due date', render: r => date(r.dueDate) },
          { key: 'total', label: 'Total', render: r => money(r.total) },
          { key: 'paidAmount', label: 'Paid', render: r => money(r.paidAmount) },
          { key: 'outstanding', label: 'Outstanding', render: r => money(r.outstanding) },
          { key: 'status', label: 'Status', render: r => <><Status>{r.status}</Status>{r.overdue && <Status>Overdue</Status>}</> },
          { key: 'actions', label: 'Actions', render: r => <div className="action-row">
            <Button variant="tiny secondary" onClick={() => printInvoice(r)}>Print</Button>
            {!isCustomer && ['Confirmed', 'Paid'].includes(r.status) && <Button variant="tiny secondary" onClick={() => send(r._id)}>Send</Button>}
            {!isCustomer && r.status === 'Draft' && <Button variant="tiny" onClick={() => change(r._id, 'Confirmed')}>Confirm</Button>}
            {!isCustomer && ['Draft', 'Confirmed'].includes(r.status) && !r.paidAmount && <Button variant="danger-tiny" onClick={() => change(r._id, 'Cancelled')}>Cancel</Button>}
          </div> }
        ]} />}
      <Pager meta={meta} onPage={setPage} />
    </section>
  </>;
}

export function Payments({ user, notify }) {
  const isCustomer = user.role === 'customer';
  const [page, setPage] = useState(1);
  const { data, meta, loading, error, reload } = useLoad(`/billing/payments?page=${page}&limit=20`);
  const { data: payable, reload: reloadPayable } = useLoad(isCustomer ? null : '/billing/invoices?payable=1&limit=100');
  const [f, setF] = useState({ invoice: '', amount: '', method: 'UPI', date: new Date().toISOString().slice(0, 10), note: '' });
  const picked = payable.find(i => i._id === f.invoice);
  useEffect(() => { if (payable.length && !picked) setF(x => ({ ...x, invoice: payable[0]._id, amount: payable[0].outstanding.toFixed(2) })); }, [payable]);

  const submit = async e => {
    e.preventDefault();
    try {
      await api('/billing/payments', { method: 'POST', body: { ...f, amount: Number(f.amount) } });
      notify('Payment recorded'); setF(x => ({ ...x, invoice: '', amount: '', note: '' })); reload(); reloadPayable();
    } catch (err) { notify(err.message); }
  };
  return <>
    <PageHead eyebrow="CASH COLLECTION" title="Payments" description="Record money received against the correct invoice. Partial payments are supported." />
    {!isCustomer && <section className="panel form-panel">
      <div className="panel-head"><div><h3>Record payment</h3><p>Only confirmed invoices with a balance are listed. A payment cannot exceed the balance.</p></div></div>
      <form className="form-grid three" onSubmit={submit}>
        <Field label="Invoice"><Select required value={f.invoice} onChange={e => { const v = payable.find(i => i._id === e.target.value); setF({ ...f, invoice: e.target.value, amount: v ? v.outstanding.toFixed(2) : '' }); }}>
          <option value="">Select invoice</option>{payable.map(i => <option key={i._id} value={i._id}>{i.number} · {i.customer?.name} · balance {money(i.outstanding)}</option>)}</Select></Field>
        <Field label="Amount (₹)"><TextInput type="number" min="0.01" max={picked?.outstanding} step="0.01" required value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Payment method"><Select value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>{['UPI', 'Card', 'Bank Transfer', 'Cash', 'Other'].map(x => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Payment date"><TextInput type="date" max={new Date().toISOString().slice(0, 10)} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Note"><TextInput maxLength={200} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
        <div className="form-actions"><Button disabled={!payable.length}><Plus size={15} /> Record payment</Button></div>
      </form>
    </section>}
    <section className="panel table-panel">
      <div className="panel-head"><div><h3>Payment history</h3><p>Payments linked to invoices, newest first.</p></div><span className="count-pill">{meta?.total ?? data.length} payments</span></div>
      {error && <div className="notice" role="alert">{error}</div>}
      {loading ? <div className="loading">Loading payments…</div> :
        <DataTable caption="Payments" rows={data} columns={[
          { key: 'invoice', label: 'Invoice', render: r => r.invoice?.number || '—' },
          ...(isCustomer ? [] : [{ key: 'customer', label: 'Customer', render: r => r.customer?.name || '—' }]),
          { key: 'amount', label: 'Amount', render: r => money(r.amount) },
          { key: 'method', label: 'Method' },
          { key: 'date', label: 'Date', render: r => date(r.date) },
          { key: 'note', label: 'Note' }
        ]} />}
      <Pager meta={meta} onPage={setPage} />
    </section>
  </>;
}
