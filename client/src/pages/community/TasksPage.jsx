import { useState, useEffect } from 'react';
import { useListState } from '../../hooks/useListState.js';
import { ListSearch, Pagination, EmptyList } from '../../components/ListControls.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResource } from '../../hooks/useResource.js';
import { api } from '../../services/api.js';
import ModulePanel from '../../components/ModulePanel.jsx';

function toDatetimeLocal(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// @edit:TASKS_UI — volunteer assignment and progress tracker
export default function TasksPage() {
  const { user } = useAuth();
  const list = useListState();
  const activeFilter = list.filter, setActiveFilter = list.setFilter;
  const r = useResource('/browse/tasks?' + list.query + '&category=' + encodeURIComponent(activeFilter));
  const staff = user?.roles.includes('organizer');

  const [people, setPeople] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showComposer, setShowComposer] = useState(false);

  // Edit & Delete state
  const [editingTask, setEditingTask] = useState(null);
  const [deletingTask, setDeletingTask] = useState(null);

  useEffect(() => {
    if (staff) {
      api('/tasks/assignees')
        .then((v) => setPeople(v.data))
        .catch((e) => setError(e.message));
    }
  }, [staff]);

  async function create(e) {
    e.preventDefault();
    const f = e.currentTarget;
    const v = Object.fromEntries(new FormData(f));
    v.dueAt = v.dueAt ? new Date(v.dueAt).toISOString() : null;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/tasks', { method: 'POST', body: v });
      f.reset();
      setShowComposer(false);
      setNotice('Volunteer task assigned successfully.');
      list.search('');
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function update(id, status) {
    setBusy(true);
    setError('');
    try {
      await api('/tasks/' + id, { method: 'PATCH', body: { status } });
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editingTask) return;
    const f = e.currentTarget;
    const v = Object.fromEntries(new FormData(f));
    v.dueAt = v.dueAt ? new Date(v.dueAt).toISOString() : null;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/tasks/${editingTask.id}`, { method: 'PUT', body: v });
      setEditingTask(null);
      setNotice('Task updated successfully.');
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingTask) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/tasks/${deletingTask.id}`, { method: 'DELETE' });
      setDeletingTask(null);
      setNotice('Task deleted successfully.');
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const rawTasks = r.data?.data || [];
  const todoCount = rawTasks.filter((t) => t.status === 'todo').length;
  const inProgressCount = rawTasks.filter((t) => t.status === 'in_progress').length;
  const doneCount = rawTasks.filter((t) => t.status === 'done').length;

  const filteredTasks = rawTasks.filter((t) => {
    if (activeFilter === 'todo') return t.status === 'todo';
    if (activeFilter === 'in_progress') return t.status === 'in_progress';
    if (activeFilter === 'done') return t.status === 'done';
    return true;
  });

  return (
    <ModulePanel
      title={staff ? 'Volunteer Tasks Board' : 'My Volunteer Tasks'}
      description="Track campus event assignments, team responsibilities and operational progress."
      resource={r}
    >
      <p className="muted">Counters show this page; filters search all matching records.</p>
      {/* Dashboard Metrics Bar */}
      <div className="tasks-dashboard-bar">
        <div className="tasks-stats-row">
          <div className="tasks-stat-card">
            <span className="tasks-stat-label">Total Assignments</span>
            <span className="tasks-stat-val">{rawTasks.length}</span>
          </div>
          <div className="tasks-stat-card">
            <span className="tasks-stat-label">To Do</span>
            <span className="tasks-stat-val todo">{todoCount}</span>
          </div>
          <div className="tasks-stat-card">
            <span className="tasks-stat-label">In Progress</span>
            <span className="tasks-stat-val in_progress">{inProgressCount}</span>
          </div>
          <div className="tasks-stat-card">
            <span className="tasks-stat-label">Completed</span>
            <span className="tasks-stat-val done">{doneCount}</span>
          </div>
        </div>

        {/* Filter Pills & Actions */}
        <div className="tasks-controls-row">
          <div className="tasks-filter-pills" role="tablist" aria-label="Filter tasks">
            <button
              type="button"
              className={`task-filter-pill ${activeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              All Tasks ({rawTasks.length})
            </button>
            <button
              type="button"
              className={`task-filter-pill ${activeFilter === 'todo' ? 'active' : ''}`}
              onClick={() => setActiveFilter('todo')}
            >
              ○ To Do ({todoCount})
            </button>
            <button
              type="button"
              className={`task-filter-pill ${activeFilter === 'in_progress' ? 'active' : ''}`}
              onClick={() => setActiveFilter('in_progress')}
            >
              ⚡ In Progress ({inProgressCount})
            </button>
            <button
              type="button"
              className={`task-filter-pill ${activeFilter === 'done' ? 'active' : ''}`}
              onClick={() => setActiveFilter('done')}
            >
              ✓ Done ({doneCount})
            </button>
          </div>

          {staff && (
            <button
              type="button"
              className="task-create-btn"
              onClick={() => setShowComposer(!showComposer)}
            >
              {showComposer ? '✕ Close Composer' : '+ Assign New Task'}
            </button>
          )}
        </div>
      </div>

      <ListSearch list={list} label="Search tasks or assignees" />

      {error && (
        <p role="alert" className="form-error" style={{ marginBlock: 'var(--space-3)' }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status" style={{ marginBlock: 'var(--space-3)' }}>
          {notice}
        </p>
      )}

      {/* Staff Composer Card */}
      {staff && showComposer && (
        <form className="task-composer-card module-form" onSubmit={create}>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Assign a Volunteer Task</h2>
          <label>
            Title
            <input
              name="title"
              minLength="3"
              maxLength="160"
              required
              placeholder="e.g. Set up registration check-in banner"
            />
          </label>
          <label>
            Description (optional)
            <textarea
              name="description"
              maxLength="3000"
              rows="3"
              placeholder="Details and guidelines for the assigned volunteer..."
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <label>
              Assign to
              <select name="assigneeId" required>
                <option value="">Choose a volunteer…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.email})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due date (optional)
              <input type="datetime-local" name="dueAt" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem' }}>
            <button className="button" disabled={busy}>
              {busy ? 'Assigning…' : 'Assign task'}
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

      {/* Tasks Grid */}
      <div className="tasks-grid">
        {!r.loading &&
          filteredTasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              busy={busy}
              staff={staff}
              onUpdate={update}
              onEdit={setEditingTask}
              onDelete={setDeletingTask}
            />
          ))}
      </div>

      {!r.loading && filteredTasks.length === 0 && (
        <EmptyList
          title={list.q ? 'No matching tasks' : 'No tasks in this category'}
          message={list.q ? 'Try another keyword or filter.' : 'Assigned tasks will appear here.'}
        />
      )}

      <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="tasks" />

      {/* Edit Task Modal */}
      {editingTask && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingTask(null);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '12px',
              padding: '1.75rem',
              maxWidth: '540px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>✏️ Edit Volunteer Task</h2>
              <button
                type="button"
                onClick={() => setEditingTask(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '1.25rem',
                  cursor: 'pointer',
                  color: '#64748b',
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="module-form" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <label>
                <strong>Task Title</strong>
                <input
                  name="title"
                  defaultValue={editingTask.title}
                  minLength="3"
                  maxLength="160"
                  required
                />
              </label>

              <label>
                <strong>Description</strong>
                <textarea
                  name="description"
                  defaultValue={editingTask.description || ''}
                  maxLength="3000"
                  rows="3"
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                <label>
                  <strong>Assign to</strong>
                  <select name="assigneeId" defaultValue={editingTask.assigneeId || ''} required>
                    <option value="">Choose a volunteer…</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.email})
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <strong>Status</strong>
                  <select name="status" defaultValue={editingTask.status || 'todo'}>
                    <option value="todo">○ To Do</option>
                    <option value="in_progress">⚡ In Progress</option>
                    <option value="done">✓ Done</option>
                  </select>
                </label>
              </div>

              <label>
                <strong>Due Date (optional)</strong>
                <input
                  type="datetime-local"
                  name="dueAt"
                  defaultValue={toDatetimeLocal(editingTask.dueAt)}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setEditingTask(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button type="submit" className="button" disabled={busy}>
                  {busy ? 'Saving changes…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Task Confirmation Modal */}
      {deletingTask && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeletingTask(null);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '12px',
              padding: '1.75rem',
              maxWidth: '460px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <h3 style={{ margin: '0 0 0.75rem', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🗑️</span> Delete Task
            </h3>
            <p style={{ margin: '0 0 1.25rem', color: '#334155', lineHeight: 1.5 }}>
              Are you sure you want to permanently delete <strong>&ldquo;{deletingTask.title}&rdquo;</strong>? This task and its history will be removed.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setDeletingTask(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button"
                style={{ background: '#dc2626', color: '#fff', border: '1px solid #b91c1c' }}
                onClick={handleConfirmDelete}
                disabled={busy}
              >
                {busy ? 'Deleting…' : 'Yes, Delete Task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModulePanel>
  );
}

function TaskCard({ task, busy, staff, onUpdate, onEdit, onDelete }) {
  const isDone = task.status === 'done';
  const isOverdue = task.dueAt && new Date(task.dueAt) < new Date() && !isDone;

  const assigneeInitial = (task.assigneeName || 'V').charAt(0).toUpperCase();

  return (
    <article className={`task-card ${isDone ? 'is-done' : ''}`}>
      <div className={`task-card-stripe ${task.status}`} />

      <div className="task-card-body">
        {/* Top Status, Action Buttons, and Due Date */}
        <div className="task-card-top" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span className={`task-status-tag ${task.status}`}>
            {task.status === 'done'
              ? '✓ Done'
              : task.status === 'in_progress'
              ? '⚡ In Progress'
              : '○ To Do'}
          </span>

          {staff && (
            <div style={{ display: 'flex', gap: '0.35rem', marginLeft: 'auto' }}>
              <button
                type="button"
                className="button button-secondary"
                style={{ padding: '0.2rem 0.55rem', fontSize: '0.78rem', borderRadius: '6px' }}
                onClick={() => onEdit(task)}
                title="Edit Task"
              >
                ✏️ Edit
              </button>
              <button
                type="button"
                className="button"
                style={{
                  padding: '0.2rem 0.55rem',
                  fontSize: '0.78rem',
                  borderRadius: '6px',
                  background: '#fee2e2',
                  color: '#b91c1c',
                  border: '1px solid #fca5a5',
                }}
                onClick={() => onDelete(task)}
                title="Delete Task"
              >
                🗑️ Delete
              </button>
            </div>
          )}

          <div className={`task-due-date ${isOverdue ? 'overdue' : ''}`} style={{ width: '100%', marginTop: '0.25rem' }}>
            <span>📅</span>
            <span>
              {task.dueAt
                ? new Date(task.dueAt).toLocaleDateString('en-GB', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Flexible due date'}
            </span>
          </div>
        </div>

        {/* Title & Description */}
        <h2 className="task-title">{task.title}</h2>
        <p className="task-desc">
          {task.description || 'No additional instructions provided.'}
        </p>

        {/* Assignee Information */}
        <div className="task-assignee-row">
          <div className="task-assignee-avatar">{assigneeInitial}</div>
          <div>
            <span style={{ fontSize: '0.72rem', display: 'block', color: 'var(--color-muted)' }}>
              Assigned to
            </span>
            <strong style={{ color: 'var(--color-text)' }}>{task.assigneeName}</strong>
          </div>
        </div>

        {/* Interactive Segmented Status Switcher */}
        <div>
          <span
            style={{
              display: 'block',
              fontSize: '0.72rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--color-muted)',
              marginBottom: '0.35rem',
            }}
          >
            Update Progress
          </span>
          <div className="task-status-switcher" role="group" aria-label="Progress status">
            <button
              type="button"
              disabled={busy}
              className={`task-status-btn ${task.status === 'todo' ? 'active todo' : ''}`}
              onClick={() => onUpdate(task.id, 'todo')}
            >
              ○ To Do
            </button>
            <button
              type="button"
              disabled={busy}
              className={`task-status-btn ${task.status === 'in_progress' ? 'active in_progress' : ''}`}
              onClick={() => onUpdate(task.id, 'in_progress')}
            >
              ⚡ In Progress
            </button>
            <button
              type="button"
              disabled={busy}
              className={`task-status-btn ${task.status === 'done' ? 'active done' : ''}`}
              onClick={() => onUpdate(task.id, 'done')}
            >
              ✓ Done
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
