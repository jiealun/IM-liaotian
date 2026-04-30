-- ===== IM Chat App - Supabase Schema (No Auth) =====
-- Run in Supabase SQL Editor

-- 1. Users table
CREATE TABLE IF NOT EXISTS chat_users (
  id         TEXT PRIMARY KEY,
  nickname   TEXT NOT NULL UNIQUE,
  is_online  BOOLEAN DEFAULT true,
  last_seen  TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Messages (supports text, image, file, reply)
CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  sender_id   TEXT NOT NULL REFERENCES chat_users(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL REFERENCES chat_users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL DEFAULT '',
  msg_type    TEXT NOT NULL DEFAULT 'text' CHECK (msg_type IN ('text','image','file')),
  file_url    TEXT DEFAULT '',
  file_name   TEXT DEFAULT '',
  reply_to    BIGINT DEFAULT NULL REFERENCES chat_messages(id) ON DELETE SET NULL,
  is_read     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_chat_msg_sender   ON chat_messages(sender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_msg_receiver ON chat_messages(receiver_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_msg_pair     ON chat_messages(sender_id, receiver_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_users_online ON chat_users(is_online);

-- 4. Enable Realtime (safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_users'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_users;
  END IF;
END $$;

-- 5. RLS open access
ALTER TABLE chat_users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_users_all" ON chat_users;
CREATE POLICY "chat_users_all" ON chat_users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "chat_messages_all" ON chat_messages;
CREATE POLICY "chat_messages_all" ON chat_messages FOR ALL USING (true) WITH CHECK (true);

-- 6. Create storage bucket for file uploads (run once)
-- Go to Supabase Dashboard -> Storage -> Create bucket named "chat-files", set to Public
