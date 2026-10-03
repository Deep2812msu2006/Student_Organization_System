import { useListState } from '../../hooks/useListState.js';
import { ListSearch, Pagination } from '../../components/ListControls.jsx';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResource } from '../../hooks/useResource.js';
import { api } from '../../services/api.js';
import ModulePanel from '../../components/ModulePanel.jsx';

// @edit:ANNOUNCEMENTS_UI — text is rendered safely by React, never injected as HTML.
export default function AnnouncementsPage() {
  const { user } = useAuth();
  const list = useListState();
  const r = useResource('/browse/announcements?' + list.query);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const staff = user?.roles.includes('organizer');

  async function create(e) {
    e.preventDefault();
    const f = e.currentTarget;
    const v = Object.fromEntries(new FormData(f));
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/announcements', { method: 'POST', body: v });
      f.reset();
      setNotice('Draft announcement created.');
      list.search('');
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function update(e) {
    e.preventDefault();
    if (!editingItem) return;
    const f = e.currentTarget;
    const v = Object.fromEntries(new FormData(f));
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/announcements/' + editingItem.id, { method: 'PUT', body: v });
      setEditingItem(null);
      setNotice('Announcement updated successfully.');
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/announcements/' + id, { method: 'DELETE' });
      setDeleteConfirmId(null);
      setNotice('Announcement deleted successfully.');
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function publish(id) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/announcements/' + id + '/publish', { method: 'POST', body: {} });
      setNotice('Announcement published.');
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModulePanel title="Announcements" description="News, upcoming activities and updates from your club." resource={r}>
      <ListSearch list={list} label="Search announcements" />
      {error && <div className="form-error" role="alert" style={{ marginBlock: 'var(--space-3)' }}>{error}</div>}
      {notice && <p className="notice" role="status" style={{ marginBlock: 'var(--space-3)' }}>{notice}</p>}

      {staff && (
        <form className="form-card module-form" onSubmit={create}>
          <h2>Write an announcement</h2>
          <label>Title<input name="title" minLength="3" maxLength="160" required placeholder="e.g. Annual General Meeting Notice" /></label>
          <label>Message<textarea name="body" minLength="3" maxLength="10000" rows="4" required placeholder="Write the details of your announcement here..." /></label>
          <label>
            Audience
            <select name="audience">
              <option value="public">Everyone</option>
              <option value="members">Signed-in community</option>
            </select>
          </label>
          <button className="button" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>
        </form>
      )}

      <div className="module-grid">
        {r.data?.data.map((a) => (
          <article className="form-card" key={a.id} style={{ display: 'flex', flexDirection: 'column' }}>
            {editingItem?.id === a.id ? (
              <form onSubmit={update} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0 }}>Edit Announcement</h3>
                  <span className="status-pill">{a.status}</span>
                </div>
                <label>
                  Title
                  <input name="title" defaultValue={editingItem.title} minLength="3" maxLength="160" required />
                </label>
                <label>
                  Message
                  <textarea name="body" defaultValue={editingItem.body} minLength="3" maxLength="10000" rows="5" required />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                  <label>
                    Audience
                    <select name="audience" defaultValue={editingItem.audience}>
                      <option value="public">Everyone</option>
                      <option value="members">Signed-in community</option>
                    </select>
                  </label>
                  <label>
                    Status
                    <select name="status" defaultValue={editingItem.status}>
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                    </select>
                  </label>
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem' }}>
                  <button className="button" disabled={busy}>
                    {busy ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => setEditingItem(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span className="status-pill" style={{ background: a.status === 'published' ? '#dcfce7' : '#fef3c7', color: a.status === 'published' ? '#166534' : '#92400e' }}>
                    {a.status}
                  </span>
                  <small className="muted" style={{ fontWeight: 600 }}>
                    {a.audience === 'public' ? '🌐 Public' : '🔒 Members only'}
                  </small>
                </div>

                <h2 style={{ margin: '0.4rem 0 0.6rem', fontSize: '1.25rem' }}>{a.title}</h2>
                <p className="preserve-lines" style={{ flexGrow: 1, margin: 0, marginBottom: '1rem', color: 'var(--color-muted)' }}>
                  {a.body}
                </p>

                {deleteConfirmId === a.id ? (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.8rem', marginTop: 'auto' }}>
                    <p style={{ margin: '0 0 0.6rem 0', color: '#991b1b', fontSize: '0.88rem', fontWeight: 600 }}>
                      ⚠️ Delete this announcement permanently?
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="button"
                        style={{ background: '#dc2626', color: '#fff', fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
                        disabled={busy}
                        onClick={() => remove(a.id)}
                      >
                        {busy ? 'Deleting…' : 'Yes, Delete'}
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
                        disabled={busy}
                        onClick={() => setDeleteConfirmId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  staff && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: 'auto', paddingTop: '0.8rem', borderTop: '1px solid var(--color-border)' }}>
                      {a.status === 'draft' && (
                        <button
                          type="button"
                          disabled={busy}
                          className="button"
                          style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                          onClick={() => publish(a.id)}
                        >
                          Publish
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        className="button button-secondary"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                        onClick={() => {
                          setEditingItem(a);
                          setDeleteConfirmId(null);
                        }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="button button-secondary"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem', color: '#dc2626', borderColor: '#fecaca' }}
                        onClick={() => {
                          setDeleteConfirmId(a.id);
                          setEditingItem(null);
                        }}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  )
                )}
              </>
            )}
          </article>
        ))}
      </div>

      {!r.loading && r.data?.data.length === 0 && <p>No announcements yet.</p>}
      <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="announcements" />
    </ModulePanel>
  );
}

