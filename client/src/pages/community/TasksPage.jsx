import { useState, useEffect } from 'react';
import { useListState } from '../../hooks/useListState.js';
import { ListSearch, Pagination, EmptyList } from '../../components/ListControls.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResource } from '../../hooks/useResource.js';
import { api } from '../../services/api.js';
import ModulePanel from '../../components/ModulePanel.jsx';

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
            <TaskCard key={t.id} task={t} busy={busy} onUpdate={update} />
          ))}
      </div>

      {!r.loading && filteredTasks.length === 0 && (
        <EmptyList
          title={list.q ? 'No matching tasks' : 'No tasks in this category'}
          message={list.q ? 'Try another keyword or filter.' : 'Assigned tasks will appear here.'}
        />
      )}

      <Pagination list={list} pagination={r.data?.pagination} loading={r.loading} label="tasks" />
    </ModulePanel>
  );
}

function TaskCard({ task, busy, onUpdate }) {
  const isDone = task.status === 'done';
  const isOverdue = task.dueAt && new Date(task.dueAt) < new Date() && !isDone;

  const assigneeInitial = (task.assigneeName || 'V').charAt(0).toUpperCase();

  return (
    <article className={`task-card ${isDone ? 'is-done' : ''}`}>
      <div className={`task-card-stripe ${task.status}`} />

      <div className="task-card-body">
        {/* Top Status and Due Date */}
        <div className="task-card-top">
          <span className={`task-status-tag ${task.status}`}>
            {task.status === 'done'
              ? '✓ Done'
              : task.status === 'in_progress'
              ? '⚡ In Progress'
              : '○ To Do'}
          </span>

          <div className={`task-due-date ${isOverdue ? 'overdue' : ''}`}>
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
