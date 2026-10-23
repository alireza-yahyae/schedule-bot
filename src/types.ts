// Shared types for the bot.

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  OWNER_ID: string;
  /** Public https address of this Worker (set in wrangler.toml [vars]). Used for the Mini App button. */
  APP_URL?: string;
  /** Public bot: one private database per person (a Durable Object each). */
  TENANT: DurableObjectNamespace;
  /** How many people may use the bot (default 40). */
  MAX_USERS?: string;
  /** The main database with the list of people (inside a person's own database this is how it is reached). */
  REGISTRY?: D1Database;
  /** Set inside a person's own database: their Telegram id (same as OWNER_ID there). */
  TENANT_ID?: string;
}

/** One concrete class on one concrete date (created from a weekly session). */
export interface Occ {
  id: number;
  session_id: number | null;
  course_id: number | null;
  date: string; // local date YYYY-MM-DD
  title: string;
  location: string | null;
  start_ts: number; // epoch seconds
  end_ts: number;
  // upcoming | awaiting_reason | attended | cancelled | skipped | no_response | unmarked
  status: string;
  nag_count: number;
  next_nag_ts: number | null; // null = the "class time" message has not been sent yet
  snooze_until: number | null;
  snooze_count: number;
  skip_reason: string | null;
  last_msg_id: number | null;
  last_msg_kind: string | null;
  acked_at?: number | null; // «باشه» was pressed: stay quiet, count the class as attended when it ends
  awaiting_since: number | null;
  is_test: number;
  resolved_at: number | null;
  kind?: string; // class | work
}

export interface OccJoined extends Occ {
  c_offsets: string | null;
  c_nag: number | null;
}

export interface Settings {
  timezone: string;
  offsets: number[]; // minutes before start, biggest first
  nagIntervalMin: number;
  maxNags: number;
  snoozeMin: number;
  vacation: boolean;
  pausedUntil: number;
  digits: 'fa' | 'en';
  /** After «باشه» on a reminder: send one plain heads-up when the class starts (no buttons, no questions). */
  ackStartNotice: boolean;
}

// ---- Minimal Telegram types (only what we use) ----
export interface TgUser {
  id: number;
  first_name?: string;
}
export interface TgChat {
  id: number;
  type: string;
}
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
}
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}
export interface InlineButton {
  text: string;
  callback_data?: string;
  web_app?: { url: string };
}
export type InlineKeyboard = InlineButton[][];

// ---- Phase 2: partner messages ----
export type Role = 'owner' | 'partner';

export type TemplateCategory = 'partner_not_studying' | 'user_slacking' | 'user_studied_hard' | 'custom_scheduled';
export type TimeCondition = 'morning' | 'night' | 'after_2_hours_idle' | 'after_4_hours_study' | 'manual' | 'any';

export interface PartnerSettings {
  id: number;
  chat_id: string | null;
  name: string;
  pairing_code: string | null;
  allow_partner_edit_templates: number;
  auto_notify_enabled: number;
  idle_threshold_hours: number;
  hard_study_threshold_hours: number;
  last_notified_at: number | null;
  paired_at: number | null;
  allow_partner_send: number;
  share_study: number;
  share_schedule: number;
}

export interface MessageTemplate {
  id: number;
  category: TemplateCategory;
  time_condition: TimeCondition;
  message_text: string;
  created_by: 'user' | 'partner';
  is_active: number;
  created_at: number;
}
