-- 0011_remove_imported_task_chat.sql
-- Owner decision 2026-10-02: the Task Management rows imported from the Excel master sheet
-- ("[Imported task] ..." chat messages, T-004) are not wanted in the chat. They are removed together
-- with their read marks, mention notifications and `chat_posted` activities, so no empty tombstones
-- remain. They are not lost: the pre-migration dump (`npm run db:migrate:*`), the Dropbox copy and the
-- frozen Excel hold them. A database without such messages is unchanged. Only messages whose text starts
-- with the import marker are touched; messages people wrote are never matched.

DELETE FROM chat_reads WHERE message_id IN (SELECT id FROM chat_messages WHERE body LIKE '[Imported task]%');
DELETE FROM chat_read_state WHERE message_id IN (SELECT id FROM chat_messages WHERE body LIKE '[Imported task]%');
DELETE FROM chat_mentions WHERE message_id IN (SELECT id FROM chat_messages WHERE body LIKE '[Imported task]%');
DELETE FROM activities
 WHERE ref_type = 'chat_message'
   AND ref_id IN (SELECT id FROM chat_messages WHERE body LIKE '[Imported task]%');
DELETE FROM chat_messages WHERE body LIKE '[Imported task]%';
