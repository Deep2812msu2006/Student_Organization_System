-- @rule:OUTBOX_DEDUP — one durable notification per source and recipient.
CREATE TABLE announcements (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 160),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 3 AND 10000),
 audience TEXT NOT NULL CHECK(audience IN ('public','members')),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
 author_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 published_at TIMESTAMPTZ
);
CREATE TABLE mail_preferences (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 subscribed BOOLEAN NOT NULL DEFAULT false, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE message_outbox (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_key TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','previewed','suppressed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), processed_at TIMESTAMPTZ,
 UNIQUE(user_id,source_key)
);
CREATE INDEX message_outbox_queue ON message_outbox(status,created_at);
CREATE TABLE volunteer_tasks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 160),
 description TEXT NOT NULL DEFAULT '', assignee_id UUID NOT NULL REFERENCES users(id),
 created_by UUID NOT NULL REFERENCES users(id), event_id UUID REFERENCES events(id),
 due_at TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX volunteer_tasks_assignee ON volunteer_tasks(assignee_id,status);
CREATE TABLE task_history (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), task_id UUID NOT NULL REFERENCES volunteer_tasks(id) ON DELETE CASCADE,
 actor_id UUID NOT NULL REFERENCES users(id), status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE receipt_uploads (
 receipt_key TEXT PRIMARY KEY, owner_id UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
