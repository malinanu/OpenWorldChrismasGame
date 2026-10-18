-- The player's language, so it follows them to other devices.
ALTER TABLE users ADD COLUMN language ENUM('en','si','ta') NOT NULL DEFAULT 'en' AFTER character_id;
