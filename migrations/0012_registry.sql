-- Public bot: the list of people who use it. This file is for the main database only
-- (every person's own data lives in their own private database, see src/tenant.ts).

-- One row per Telegram user (the owner of the bot is served directly and does not need a row).
CREATE TABLE users (
  id         INTEGER PRIMARY KEY,                 -- Telegram user id
  first_name TEXT,
  username   TEXT,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  blocked    INTEGER NOT NULL DEFAULT 0
);

-- Who is whose partner: a partner's Telegram id -> the id of the person they are connected to.
CREATE TABLE partner_links (
  partner_chat_id INTEGER PRIMARY KEY,
  owner_id        INTEGER NOT NULL
);
CREATE INDEX idx_partner_links_owner ON partner_links(owner_id);
