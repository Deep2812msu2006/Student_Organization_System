import { useState } from 'react';
import { useListState } from '../../hooks/useListState.js';
import { ListSearch, Pagination, EmptyList } from '../../components/ListControls.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResource } from '../../hooks/useResource.js';
import { api } from '../../services/api.js';
import ModulePanel from '../../components/ModulePanel.jsx';
import { date } from '../../utils/format.js';

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
  const [showComposer, setShowComposer] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');

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
      setShowComposer(false);
      setNotice('New announcement created successfully.');
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
      setNotice('Announcement published to campus community.');
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const rawData = r.data?.data || [];
  const filteredData = rawData.filter((a) => {
    if (activeFilter === 'public') return a.audience === 'public';
    if (activeFilter === 'members') return a.audience === 'members';
    if (activeFilter === 'drafts') return a.status === 'draft';
    return true;
  });

  return (
    <ModulePanel
      title="Club Announcements"
      description="Official campus news, upcoming milestones and important updates from your student association."
      resource={r}
    >
      {/* Header Bar with Quick Filters and Staff Composer Button */}
      <div className="announcements-header-bar">
        <div className="announcements-filter-pills" role="tablist" aria-label="Filter announcements">
          <button
            type="button"
            className={`announcement-filter-btn ${activeFilter === 'all' ? 'active' : ''}`}
            onClick={() => setActiveFilter('all')}
          >
            All Updates ({rawData.length})
          </button>
          <button
            type="button"
            className={`announcement-filter-btn ${activeFilter === 'public' ? 'active' : ''}`}
            onClick={() => setActiveFilter('public')}
          >
            🌐 Public ({rawData.filter((a) => a.audience === 'public').length})
          </button>
          <button
            type="button"
            className={`announcement-filter-btn ${activeFilter === 'members' ? 'active' : ''}`}
            onClick={() => setActiveFilter('members')}
          >
            🔒 Members Only ({rawData.filter((a) => a.audience === 'members').length})
          </button>
          {staff && rawData.some((a) => a.status === 'draft') && (
            <button
              type="button"
              className={`announcement-filter-btn ${activeFilter === 'drafts' ? 'active' : ''}`}
              onClick={() => setActiveFilter('drafts')}
            >
              📝 Drafts ({rawData.filter((a) => a.status === 'draft').length})
            </button>
          )}
        </div>

        {staff && (
          <button
            type="button"
            className="announcement-create-trigger"
            onClick={() => setShowComposer(!showComposer)}
          >
            {showComposer ? '✕ Close Composer' : '+ Write Announcement'}
          </button>
        )}
      </div>

      <ListSearch list={list} label="Search announcements" />

      {error && (
        <div className="form-error" role="alert" style={{ marginBlock: 'var(--space-3)' }}>
          {error}
        </div>
      )}
      {notice && (
        <p className="notice" role="status" style={{ marginBlock: 'var(--space-3)' }}>
          {notice}
        </p>
      )}

      {/* Staff Composer Card */}
      {staff && showComposer && (
        <form className="announcement-composer-card module-form" onSubmit={create}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Write an announcement</h2>
            <span className="announcement-status-tag draft">Draft by default</span>
          </div>
          <label>
            Title
            <input
              name="title"
              minLength="3"
              maxLength="160"
              required
              placeholder="e.g. Annual General Meeting Notice"
            />
          </label>
          <label>
            Message
            <textarea
              name="body"
              minLength="3"
              maxLength="10000"
              rows="4"
              required
              placeholder="Write the details of your announcement here..."
            />
          </label>
          <label>
            Audience
            <select name="audience">
              <option value="public">🌐 Everyone (Public)</option>
              <option value="members">🔒 Signed-in Community Members Only</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.4rem' }}>
            <button className="button" disabled={busy}>
              {busy ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setShowComposer(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Grid of Announcements */}
      <div className="announcements-grid">
        {!r.loading &&
          filteredData.map((item) => (
            <AnnouncementCard
              key={item.id}
              item={item}
              staff={staff}
              busy={busy}
              editingItem={editingItem}
              setEditingItem={setEditingItem}
              update={update}
              deleteConfirmId={deleteConfirmId}
              setDeleteConfirmId={setDeleteConfirmId}
              remove={remove}
              publish={publish}
            />
          ))}
      </div>

      {!r.loading && filteredData.length === 0 && (
        <EmptyList
          title={list.q ? 'No matching announcements' : 'No announcements in this category'}
          message={list.q ? 'Try another keyword or clear search.' : 'New announcements will appear here when posted.'}
        />
      )}

      <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="announcements" />
    </ModulePanel>
  );
}

function AnnouncementCard({
  item,
  staff,
  busy,
  editingItem,
  setEditingItem,
  update,
  deleteConfirmId,
  setDeleteConfirmId,
  remove,
  publish,
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const isLong = item.body && item.body.length > 200;
  const author = item.authorName || 'Skyline Staff';
  const authorInitial = author.charAt(0).toUpperCase();

  function copyText() {
    navigator.clipboard.writeText(`${item.title}\n\n${item.body}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const stripeClass =
    item.status === 'draft' ? 'draft' : item.audience === 'public' ? 'public' : 'members';

  return (
    <article className="announcement-card">
      <div className={`announcement-stripe ${stripeClass}`} />

      <div className="announcement-card-body">
        {editingItem?.id === item.id ? (
          <form onSubmit={update} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Edit Announcement</h3>
              <span className="announcement-status-tag draft">{item.status}</span>
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
                  <option value="public">🌐 Everyone</option>
                  <option value="members">🔒 Members Only</option>
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
            {/* Top Metadata Row */}
            <div className="announcement-meta-top">
              <div className="announcement-badges-left">
                <span className={`announcement-audience-tag ${item.audience}`}>
                  {item.audience === 'public' ? '🌐 Public' : '🔒 Members only'}
                </span>
                {item.status === 'draft' && (
                  <span className="announcement-status-tag draft">Draft</span>
                )}
              </div>

              <div className="announcement-date-text">
                <span>📅</span>
                <span>{item.createdAt ? date(item.createdAt) : 'Recently'}</span>
              </div>
            </div>

            {/* Title */}
            <h2 className="announcement-title">{item.title}</h2>

            {/* Body */}
            <p className={`announcement-text ${isLong && !expanded ? 'clamped' : ''}`}>
              {item.body}
            </p>

            {isLong && (
              <button
                type="button"
                className="announcement-read-more"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? '▲ Show less' : '▼ Read full announcement'}
              </button>
            )}

            {/* Delete Confirmation Box */}
            {deleteConfirmId === item.id ? (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '0.8rem',
                  marginTop: 'auto',
                }}
              >
                <p style={{ margin: '0 0 0.6rem 0', color: '#991b1b', fontSize: '0.85rem', fontWeight: 600 }}>
                  ⚠️ Delete this announcement permanently?
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="button"
                    style={{ background: '#dc2626', color: '#fff', fontSize: '0.82rem', padding: '0.35rem 0.75rem' }}
                    disabled={busy}
                    onClick={() => remove(item.id)}
                  >
                    {busy ? 'Deleting…' : 'Yes, Delete'}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    style={{ fontSize: '0.82rem', padding: '0.35rem 0.75rem' }}
                    disabled={busy}
                    onClick={() => setDeleteConfirmId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* Footer: Author Info & Action Buttons */
              <div className="announcement-footer">
                <div className="announcement-author-info">
                  <div className="announcement-author-avatar">{authorInitial}</div>
                  <span>{author}</span>
                </div>

                <div className="announcement-actions-bar">
                  <button
                    type="button"
                    className="announcement-action-btn"
                    title="Copy announcement text"
                    onClick={copyText}
                  >
                    {copied ? '✓ Copied' : '📋 Copy'}
                  </button>

                  {staff && (
                    <>
                      {item.status === 'draft' && (
                        <button
                          type="button"
                          disabled={busy}
                          className="announcement-action-btn publish"
                          onClick={() => publish(item.id)}
                        >
                          🚀 Publish
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        className="announcement-action-btn"
                        onClick={() => {
                          setEditingItem(item);
                          setDeleteConfirmId(null);
                        }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="announcement-action-btn delete"
                        onClick={() => {
                          setDeleteConfirmId(item.id);
                          setEditingItem(null);
                        }}
                      >
                        🗑️ Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}
