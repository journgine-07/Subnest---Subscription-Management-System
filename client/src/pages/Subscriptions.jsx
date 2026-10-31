import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, date, money } from '../api';
import { Button, DataTable, Field, PageHead, Pager, Select, Status, TextInput, useLoad } from '../ui';

const STATUSES = ['Draft', 'Quotation', 'Confirmed', 'Active', 'Paused', 'Closed'];

export function Subscriptions({ user, notify }) {
  const isCustomer = user.role === 'customer';
  const [page, setPage] = useState(1), [status, setStatus] = useState(''), [q, setQ] = useState(''), [search, setSearch] = useState('');
  const params = new URLSearchParams({ page, limit: 20 }); if (status) params.set('status', status); if (search) params.set('q', search);
  const { data, meta, loading, error, reload } = useLoad(`/subscriptions?${params}`);
  const { data: plans } = useLoad('/catalog/plans');
  const { data: users } = useLoad(isCustomer ? null : '/auth/users?role=customer&limit=200');
  const { data: discounts } = useLoad(isCustomer ? null : '/catalog/discounts');
  const [f, setF] = useState({ customer: '', plan: '', quantity: 1, variantName: '', startDate: '', expiryDate: '', paymentTerms: 'Due in 7 days', discount: '' });
  useEffect(() => { if (plans.length && !f.plan) setF(x => ({ ...x, plan: plans[0]._id })); }, [plans]);
  const chosenPlan = plans.find(p => p._id === f.plan);
  const variants = chosenPlan?.product?.variants || [];

  const create = async e => {
    e.preventDefault();
    try {
      await api('/subscriptions', { method: 'POST', body: { ...f, quantity: Number(f.quantity), customer: f.customer || undefined, startDate: f.startDate || undefined, expiryDate: f.expiryDate || undefined, discount: f.discount || undefined } });
      setF(x => ({ ...x, quantity: 1, variantName: '', discount: '' })); notify('Subscription created'); reload();
    } catch (err) { notify(err.message); }
  };
  const move = async (id, next) => {
    if (next === 'Closed' && !window.confirm('Close this subscription? Billing will stop.')) return;
    try { await api(`/subscriptions/${id}/status`, { method: 'PATCH', body: { status: next } }); notify(`Subscription moved to ${next}`); reload(); }
    catch (err) { notify(err.message); }
  };
  const renew = async id => {
    try { await api(`/subscriptions/${id}/renew`, { method: 'POST', body: {} }); notify('Subscription renewed'); reload(); }
    catch (err) { notify(err.message); }
  };
  const actions = r => <div className="action-row">
    {!isCustomer && r.status === 'Draft' && <Button variant="tiny" onClick={() => move(r._id, 'Quotation')}>Quote</Button>}
    {!isCustomer && r.status === 'Quotation' && <Button variant="tiny" onClick={() => move(r._id, 'Confirmed')}>Confirm</Button>}
    {!isCustomer && r.status === 'Confirmed' && <Button variant="tiny" onClick={() => move(r._id, 'Active')}>Activate</Button>}
    {!isCustomer && r.status === 'Active' && <Button variant="tiny secondary" onClick={() => move(r._id, 'Paused')}>Pause</Button>}
    {!isCustomer && r.status === 'Paused' && <Button variant="tiny" onClick={() => move(r._id, 'Active')}>Resume</Button>}
    {!isCustomer && r.status === 'Closed' && <Button variant="tiny" onClick={() => renew(r._id)}>Renew</Button>}
    {r.status !== 'Closed' && <Button variant="danger-tiny" onClick={() => move(r._id, 'Closed')}>Close</Button>}
  </div>;

  return <>
    <PageHead eyebrow="CUSTOMER LIFECYCLE" title="Subscriptions" description="Create subscriptions and move each one from Draft to Quotation, Confirmed, Active and Closed." />
    <section className="panel form-panel">
      <div className="panel-head"><div><h3>New subscription</h3><p>{isCustomer ? 'Your request is created as a quotation; our team will confirm it.' : 'Choose a customer and plan. The tax rate is taken from the product.'}</p></div></div>
      <form className="form-grid three" onSubmit={create}>
        {!isCustomer && <Field label="Customer"><Select required value={f.customer} onChange={e => setF({ ...f, customer: e.target.value })}><option value="">Select customer</option>{users.map(u => <option key={u._id} value={u._id}>{u.name} · {u.email}</option>)}</Select></Field>}
        <Field label="Plan"><Select required value={f.plan} onChange={e => setF({ ...f, plan: e.target.value, variantName: '' })}>{plans.map(p => <option key={p._id} value={p._id}>{p.name} — {money(p.price)}/{p.billingFrequency}</option>)}</Select></Field>
        <Field label="Quantity"><TextInput type="number" min={chosenPlan?.minimumQuantity || 1} step="1" value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} /></Field>
        <Field label="Product variant"><Select value={f.variantName} onChange={e => setF({ ...f, variantName: e.target.value })}><option value="">Default variant</option>{variants.map(v => <option key={v.name} value={v.name}>{v.name} (+{money(v.additionalPrice)})</option>)}</Select></Field>
        <Field label="Start date"><TextInput type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="Expiry date"><TextInput type="date" value={f.expiryDate} onChange={e => setF({ ...f, expiryDate: e.target.value })} /></Field>
        {!isCustomer && <Field label="Payment terms"><TextInput value={f.paymentTerms} onChange={e => setF({ ...f, paymentTerms: e.target.value })} /></Field>}
        {!isCustomer && <Field label="Attach a discount (optional)"><Select value={f.discount} onChange={e => setF({ ...f, discount: e.target.value })}><option value="">None (auto-apply rules still work)</option>{discounts.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>}
        <div className="form-actions"><Button><Plus size={15} /> Create subscription</Button></div>
      </form>
    </section>
    <section className="panel table-panel">
      <div className="panel-head"><div><h3>{isCustomer ? 'My subscriptions' : 'All subscriptions'}</h3><p>Use the actions to progress each subscription through its lifecycle.</p></div><span className="count-pill">{meta?.total ?? data.length} records</span></div>
      <form className="toolbar" role="search" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(q.trim()); }}>
        <Select aria-label="Filter by status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</Select>
        <TextInput aria-label="Search by subscription number" placeholder="Subscription number, e.g. SUB-0000" value={q} onChange={e => setQ(e.target.value)} />
        <Button variant="secondary">Search</Button>
      </form>
      {error && <div className="notice" role="alert">{error}</div>}
      {loading ? <div className="loading">Loading subscriptions…</div> :
        <DataTable caption="Subscriptions" rows={data} columns={[
          { key: 'number', label: 'Subscription' },
          ...(isCustomer ? [] : [{ key: 'customer', label: 'Customer', render: r => r.customer?.name || '—' }]),
          { key: 'plan', label: 'Plan', render: r => r.plan?.name || '—' },
          { key: 'startDate', label: 'Start', render: r => date(r.startDate) },
          { key: 'expiryDate', label: 'Expiry / valid until', render: r => date(r.expiryDate || r.quotationValidUntil) },
          { key: 'nextBillingDate', label: 'Next billing', render: r => r.status === 'Active' ? date(r.nextBillingDate) : '—' },
          { key: 'status', label: 'Status', render: r => <Status>{r.status}</Status> },
          { key: 'actions', label: 'Actions', render: actions }
        ]} />}
      <Pager meta={meta} onPage={setPage} />
    </section>
  </>;
}
