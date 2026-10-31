import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, date } from '../api';
import { Button, DataTable, Field, PageHead, Pager, Status, TextInput, useLoad } from '../ui';

export function UsersPage({ user, notify }) {
  const [page, setPage] = useState(1), [q, setQ] = useState(''), [search, setSearch] = useState('');
  const params = new URLSearchParams({ page, limit: 20 }); if (search) params.set('q', search);
  const { data, meta, loading, error, reload } = useLoad(`/auth/users?${params}`);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const submit = async e => {
    e.preventDefault();
    try { await api('/auth/staff', { method: 'POST', body: f }); setF({ name: '', email: '', password: '' }); notify('Staff member created'); reload(); }
    catch (err) { notify(err.message); }
  };
  return <>
    <PageHead eyebrow="ACCESS CONTROL" title="Users & permissions" description="Manage staff access and review registered customers." />
    {user.role === 'admin' && <section className="panel form-panel">
      <div className="panel-head"><div><h3>Add staff member</h3><p>Only administrators can create internal staff accounts.</p></div></div>
      <form className="form-grid three" onSubmit={submit}>
        <Field label="Full name"><TextInput required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><TextInput type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Temporary password"><TextInput type="password" required minLength={9} autoComplete="new-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></Field>
        <div className="form-actions"><Button><Plus size={15} /> Create staff</Button></div>
      </form>
      <small className="hint">Password must be more than 8 characters and include uppercase, lowercase and a special character.</small>
    </section>}
    <section className="panel table-panel">
      <div className="panel-head"><div><h3>All users</h3><p>Customers can only access their own subscriptions and invoices.</p></div><span className="count-pill">{meta?.total ?? data.length} users</span></div>
      <form className="toolbar" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(q.trim()); }} role="search">
        <TextInput aria-label="Search users by name or email" placeholder="Search name or email" value={q} onChange={e => setQ(e.target.value)} />
        <Button variant="secondary">Search</Button>
      </form>
      {loading ? <div className="loading">Loading users…</div> : error ? <div className="notice" role="alert">{error}</div> :
        <DataTable caption="Users" columns={[{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role', render: r => <Status>{r.role}</Status> }, { key: 'createdAt', label: 'Joined', render: r => date(r.createdAt) }]} rows={data} />}
      <Pager meta={meta} onPage={setPage} />
    </section>
  </>;
}
