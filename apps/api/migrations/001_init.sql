CREATE TABLE users (
 id UUID PRIMARY KEY, email VARCHAR(254) UNIQUE NOT NULL, handle VARCHAR(24) UNIQUE NOT NULL,
 display_name VARCHAR(60) NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash CHAR(64) PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf_token CHAR(64) NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_session_expiry ON sessions(expires_at);
CREATE TABLE conversations (
 id UUID PRIMARY KEY, kind VARCHAR(8) NOT NULL CHECK(kind IN ('DIRECT','GROUP')),
 title VARCHAR(80), direct_key VARCHAR(73) UNIQUE, created_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK ((kind='DIRECT' AND direct_key IS NOT NULL AND title IS NULL) OR (kind='GROUP' AND title IS NOT NULL AND direct_key IS NULL))
);
CREATE TABLE members (
 conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE, user_id UUID REFERENCES users(id),
 last_read_seq BIGINT NOT NULL DEFAULT 0 CHECK(last_read_seq>=0), joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(conversation_id,user_id)
);
CREATE INDEX idx_member_user ON members(user_id,conversation_id);
CREATE TABLE messages (
 id UUID PRIMARY KEY, seq BIGSERIAL UNIQUE NOT NULL, conversation_id UUID NOT NULL REFERENCES conversations(id),
 sender_id UUID NOT NULL REFERENCES users(id), client_id UUID NOT NULL,
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(sender_id,client_id)
);
CREATE INDEX idx_message_history ON messages(conversation_id,seq DESC);
CREATE TABLE outbox (
 id BIGSERIAL PRIMARY KEY, message_id UUID UNIQUE NOT NULL REFERENCES messages(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), published_at TIMESTAMPTZ
);
CREATE INDEX idx_outbox_pending ON outbox(id) WHERE published_at IS NULL;
