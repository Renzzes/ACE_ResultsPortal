/*
  ACE Results Portal — Phase 4
  Notifications + Messaging + Announcements

  MANUAL EXECUTION ONLY.

  Target:
    ACE_ResultsPortal

  DO NOT execute against LiveDB_ACE.

  This migration creates (if missing):
    dbo.notifications
    dbo.announcements
    dbo.announcement_targets
    dbo.message_threads
    dbo.message_participants
    dbo.messages

  It does not modify existing patients, results, users, or audit_logs.
  It does not drop or truncate any tables.
  Safe to re-run (IF OBJECT_ID / IF NOT EXISTS guards).
*/

USE [ACE_ResultsPortal];
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF DB_NAME() <> N'ACE_ResultsPortal'
BEGIN
  THROW 50001, 'This script must run in ACE_ResultsPortal only.', 1;
END
GO

/* ------------------------------------------------------------------ */
/* notifications                                                      */
/* ------------------------------------------------------------------ */
IF OBJECT_ID(N'dbo.notifications', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.notifications
  (
    id INT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_notifications PRIMARY KEY,

    recipient_user_id INT NOT NULL,

    type NVARCHAR(64) NOT NULL,

    title NVARCHAR(255) NOT NULL,

    body NVARCHAR(1000) NOT NULL,

    entity_type NVARCHAR(64) NULL,

    entity_id INT NULL,

    priority NVARCHAR(32) NOT NULL
      CONSTRAINT DF_notifications_priority DEFAULT (N'normal'),

    is_read BIT NOT NULL
      CONSTRAINT DF_notifications_is_read DEFAULT (0),

    read_at DATETIMEOFFSET(7) NULL,

    created_at DATETIMEOFFSET(7) NOT NULL
      CONSTRAINT DF_notifications_created_at
      DEFAULT (SYSDATETIMEOFFSET()),

    expires_at DATETIMEOFFSET(7) NULL,

    CONSTRAINT FK_notifications_recipient_user
      FOREIGN KEY (recipient_user_id)
      REFERENCES dbo.users(id),

    CONSTRAINT CK_notifications_priority
      CHECK (priority IN (N'normal', N'important', N'urgent'))
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_notifications_recipient_unread'
    AND object_id = OBJECT_ID(N'dbo.notifications')
)
BEGIN
  CREATE INDEX IX_notifications_recipient_unread
  ON dbo.notifications (recipient_user_id, is_read, created_at DESC);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_notifications_recipient_created'
    AND object_id = OBJECT_ID(N'dbo.notifications')
)
BEGIN
  CREATE INDEX IX_notifications_recipient_created
  ON dbo.notifications (recipient_user_id, created_at DESC);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_notifications_entity'
    AND object_id = OBJECT_ID(N'dbo.notifications')
)
BEGIN
  CREATE INDEX IX_notifications_entity
  ON dbo.notifications (entity_type, entity_id);
END
GO

/* Dedup helper for same recipient + type + entity */
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_notifications_recipient_type_entity'
    AND object_id = OBJECT_ID(N'dbo.notifications')
)
BEGIN
  CREATE INDEX IX_notifications_recipient_type_entity
  ON dbo.notifications (recipient_user_id, type, entity_type, entity_id);
END
GO

/* ------------------------------------------------------------------ */
/* announcements                                                      */
/* ------------------------------------------------------------------ */
IF OBJECT_ID(N'dbo.announcements', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.announcements
  (
    id INT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_announcements PRIMARY KEY,

    title NVARCHAR(255) NOT NULL,

    body NVARCHAR(MAX) NOT NULL,

    priority NVARCHAR(32) NOT NULL
      CONSTRAINT DF_announcements_priority DEFAULT (N'normal'),

    created_by_id INT NOT NULL,

    is_published BIT NOT NULL
      CONSTRAINT DF_announcements_is_published DEFAULT (0),

    published_at DATETIMEOFFSET(7) NULL,

    expires_at DATETIMEOFFSET(7) NULL,

    created_at DATETIMEOFFSET(7) NOT NULL
      CONSTRAINT DF_announcements_created_at
      DEFAULT (SYSDATETIMEOFFSET()),

    updated_at DATETIMEOFFSET(7) NOT NULL
      CONSTRAINT DF_announcements_updated_at
      DEFAULT (SYSDATETIMEOFFSET()),

    CONSTRAINT FK_announcements_created_by
      FOREIGN KEY (created_by_id)
      REFERENCES dbo.users(id),

    CONSTRAINT CK_announcements_priority
      CHECK (priority IN (N'normal', N'important', N'urgent'))
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_announcements_published'
    AND object_id = OBJECT_ID(N'dbo.announcements')
)
BEGIN
  CREATE INDEX IX_announcements_published
  ON dbo.announcements (is_published, published_at DESC);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_announcements_created_by'
    AND object_id = OBJECT_ID(N'dbo.announcements')
)
BEGIN
  CREATE INDEX IX_announcements_created_by
  ON dbo.announcements (created_by_id, created_at DESC);
END
GO

/* ------------------------------------------------------------------ */
/* announcement_targets                                               */
/* ------------------------------------------------------------------ */
IF OBJECT_ID(N'dbo.announcement_targets', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.announcement_targets
  (
    id INT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_announcement_targets PRIMARY KEY,

    announcement_id INT NOT NULL,

    target_type NVARCHAR(32) NOT NULL,

    target_value NVARCHAR(64) NULL,

    created_at DATETIMEOFFSET(7) NOT NULL
      CONSTRAINT DF_announcement_targets_created_at
      DEFAULT (SYSDATETIMEOFFSET()),

    CONSTRAINT FK_announcement_targets_announcement
      FOREIGN KEY (announcement_id)
      REFERENCES dbo.announcements(id)
      ON DELETE CASCADE,

    CONSTRAINT CK_announcement_targets_type
      CHECK (target_type IN (N'all_staff', N'all_physicians', N'department'))
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_announcement_targets_announcement'
    AND object_id = OBJECT_ID(N'dbo.announcement_targets')
)
BEGIN
  CREATE INDEX IX_announcement_targets_announcement
  ON dbo.announcement_targets (announcement_id);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_announcement_targets_target'
    AND object_id = OBJECT_ID(N'dbo.announcement_targets')
)
BEGIN
  CREATE INDEX IX_announcement_targets_target
  ON dbo.announcement_targets (target_type, target_value);
END
GO

/* ------------------------------------------------------------------ */
/* message_threads                                                    */
/* ------------------------------------------------------------------ */
IF OBJECT_ID(N'dbo.message_threads', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.message_threads
  (
    id INT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_message_threads PRIMARY KEY,

    subject NVARCHAR(255) NOT NULL,

    patient_id INT NULL,

    created_by_id INT NOT NULL,

    is_closed BIT NOT NULL
      CONSTRAINT DF_message_threads_is_closed DEFAULT (0),

    created_at DATETIMEOFFSET(7) NOT NULL
      CONSTRAINT DF_message_threads_created_at
      DEFAULT (SYSDATETIMEOFFSET()),

    updated_at DATETIMEOFFSET(7) NOT NULL
      CONSTRAINT DF_message_threads_updated_at
      DEFAULT (SYSDATETIMEOFFSET()),

    CONSTRAINT FK_message_threads_patient
      FOREIGN KEY (patient_id)
      REFERENCES dbo.patients(id),

    CONSTRAINT FK_message_threads_created_by
      FOREIGN KEY (created_by_id)
      REFERENCES dbo.users(id)
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_message_threads_patient'
    AND object_id = OBJECT_ID(N'dbo.message_threads')
)
BEGIN
  CREATE INDEX IX_message_threads_patient
  ON dbo.message_threads (patient_id, updated_at DESC);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_message_threads_created_by'
    AND object_id = OBJECT_ID(N'dbo.message_threads')
)
BEGIN
  CREATE INDEX IX_message_threads_created_by
  ON dbo.message_threads (created_by_id, updated_at DESC);
END
GO

/* ------------------------------------------------------------------ */
/* message_participants                                               */
/* ------------------------------------------------------------------ */
IF OBJECT_ID(N'dbo.message_participants', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.message_participants
  (
    thread_id INT NOT NULL,

    user_id INT NOT NULL,

    last_read_at DATETIMEOFFSET(7) NULL,

    joined_at DATETIMEOFFSET(7) NOT NULL
      CONSTRAINT DF_message_participants_joined_at
      DEFAULT (SYSDATETIMEOFFSET()),

    CONSTRAINT PK_message_participants
      PRIMARY KEY (thread_id, user_id),

    CONSTRAINT FK_message_participants_thread
      FOREIGN KEY (thread_id)
      REFERENCES dbo.message_threads(id)
      ON DELETE CASCADE,

    CONSTRAINT FK_message_participants_user
      FOREIGN KEY (user_id)
      REFERENCES dbo.users(id)
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_message_participants_user'
    AND object_id = OBJECT_ID(N'dbo.message_participants')
)
BEGIN
  CREATE INDEX IX_message_participants_user
  ON dbo.message_participants (user_id, thread_id);
END
GO

/* ------------------------------------------------------------------ */
/* messages                                                           */
/* ------------------------------------------------------------------ */
IF OBJECT_ID(N'dbo.messages', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.messages
  (
    id INT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_messages PRIMARY KEY,

    thread_id INT NOT NULL,

    sender_user_id INT NOT NULL,

    body NVARCHAR(MAX) NOT NULL,

    is_deleted BIT NOT NULL
      CONSTRAINT DF_messages_is_deleted DEFAULT (0),

    created_at DATETIMEOFFSET(7) NOT NULL
      CONSTRAINT DF_messages_created_at
      DEFAULT (SYSDATETIMEOFFSET()),

    edited_at DATETIMEOFFSET(7) NULL,

    CONSTRAINT FK_messages_thread
      FOREIGN KEY (thread_id)
      REFERENCES dbo.message_threads(id)
      ON DELETE CASCADE,

    CONSTRAINT FK_messages_sender
      FOREIGN KEY (sender_user_id)
      REFERENCES dbo.users(id)
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_messages_thread_created'
    AND object_id = OBJECT_ID(N'dbo.messages')
)
BEGIN
  CREATE INDEX IX_messages_thread_created
  ON dbo.messages (thread_id, created_at ASC);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_messages_sender'
    AND object_id = OBJECT_ID(N'dbo.messages')
)
BEGIN
  CREATE INDEX IX_messages_sender
  ON dbo.messages (sender_user_id, created_at DESC);
END
GO
