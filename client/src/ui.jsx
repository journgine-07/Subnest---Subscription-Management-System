// Small shared building blocks used by every page.
import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';

export const Field = ({ label, children }) => <label className="field-wrap"><span>{label}</span>{children}</label>;
export const TextInput = props => <input className="field" {...props} />;
export const Select = ({ children, ...props }) => <select className="field" {...props}>{children}</select>;
export const Button = ({ children, variant = 'primary', ...props }) => <button className={`btn ${variant}`} {...props}>{children}</button>;
export const Empty = ({ children = 'No records found.' }) => <div className="empty">{children}</div>;
export const Status = ({ children }) => <span className={`status ${String(children).toLowerCase()}`}>{children}</span>;

export const DataTable = ({ columns, rows, empty = 'No records found.', caption }) => (
  <div className="table-wrap"><table>
    {caption && <caption className="sr-only">{caption}</caption>}
    <thead><tr>{columns.map(c => <th scope="col" key={c.key}>{c.label}</th>)}</tr></thead>
    <tbody>{rows.length
      ? rows.map((r, i) => <tr key={r._id || i}>{columns.map(c => <td key={c.key}>{c.render ? c.render(r) : (r[c.key] ?? '—')}</td>)}</tr>)
      : <tr><td colSpan={columns.length}><Empty>{empty}</Empty></td></tr>}</tbody>
  </table></div>
);

export const PageHead = ({ eyebrow, title, description, action }) => (
  <div className="page-head"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>
);
export const Kpi = ({ title, value, icon, tone, note }) => (
  <div className="kpi-card"><div className="kpi-top"><span>{title}</span><div className={`kpi-icon ${tone}`} aria-hidden="true">{icon}</div></div><strong>{value}</strong><small>{note}</small></div>
);

// Previous / Next controls for server-paginated lists. `meta` is {page, pages, total}.
export const Pager = ({ meta, onPage }) => !meta || meta.pages <= 1 ? null : (
  <nav className="pager" aria-label="Pagination">
    <Button variant="tiny secondary" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</Button>
    <span>Page {meta.page} of {meta.pages} · {meta.total} records</span>
    <Button variant="tiny secondary" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)}>Next</Button>
  </nav>
);

// Loads a list from the API. Handles both plain arrays and paginated {data,page,pages,total} responses.
// Pass null as the path to skip loading.
export function useLoad(path) {
  const [data, setData] = useState([]), [meta, setMeta] = useState(null), [loading, setLoading] = useState(Boolean(path)), [error, setError] = useState('');
  const latest = useRef(0);
  const load = async () => {
    if (!path) { setLoading(false); return; }
    const id = ++latest.current;                       // ignore answers that arrive after a newer request
    setLoading(true);
    try {
      const d = await api(path);
      if (id !== latest.current) return;
      if (Array.isArray(d)) { setData(d); setMeta(null); } else { setData(d.data || []); setMeta({ page: d.page, pages: d.pages, total: d.total }); }
      setError('');
    } catch (e) { if (id === latest.current) setError(e.message); }
    finally { if (id === latest.current) setLoading(false); }
  };
  useEffect(() => { load(); }, [path]);
  return { data, meta, loading, error, reload: load, setData };
}

// Escape text before putting it into the printable invoice HTML.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
