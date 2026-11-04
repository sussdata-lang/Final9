import { relations } from 'drizzle-orm';
import {
  bigint,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// 1. Studio Authenticated Users (Firebase Auth UID mapping)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  role: text('role').notNull().default('admin'),
  createdAt: timestamp('created_at').defaultNow(),
});

// 13. Argon CodeStudio Changelog (سجل التغييرات البرمجية الفوري)
export const studioChangelog = pgTable('studio_changelog', {
  id: serial('id').primaryKey(),
  entryCode: text('entry_code').notNull().unique(),
  version: text('version').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull().default('improvement'),
  filePath: text('file_path'),
  author: text('author').notNull().default('مدير النظام'),
  sizeBytes: integer('size_bytes'),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  timestampMs: bigint('timestamp_ms', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 14. DevOps Incidents & Automated Backups (بلاغات DevOps والنسخ الاحتياطي)
export const devopsIncidents = pgTable('devops_incidents', {
  id: serial('id').primaryKey(),
  reportCode: text('report_code').notNull().unique(),
  source: text('source').notNull(),
  eventType: text('event_type').notNull(),
  severity: text('severity').notNull().default('info'),
  filePath: text('file_path'),
  errorMessage: text('error_message').notNull(),
  errorDetails: text('error_details'),
  clientContext: text('client_context'),
  status: text('status').notNull().default('open'),
  createdAtMs: bigint('created_at_ms', { mode: 'number' }).notNull(),
});

// ==========================================
// Drizzle Relational Definitions
// ==========================================
 
export const usersRelations = relations(users, ({ many }) => ({
  changelogs: many(studioChangelog),
}));

export const studioChangelogRelations = relations(studioChangelog, ({ one }) => ({
  authorUser: one(users, {
    fields: [studioChangelog.userId],
    references: [users.id],
  }),
}));
