CREATE INDEX IF NOT EXISTS `steam_chat_account_timestamp_idx` ON `steam_chat_message` (`account_id`, `timestamp`);
