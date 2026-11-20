-- Fight zones: knock-outs scored and suffered, and when the last one happened (breaks ties on the Fighters board).
ALTER TABLE stats ADD COLUMN arena_kos INT UNSIGNED NOT NULL DEFAULT 0 AFTER snowball_taken;
ALTER TABLE stats ADD COLUMN arena_deaths INT UNSIGNED NOT NULL DEFAULT 0 AFTER arena_kos;
ALTER TABLE stats ADD COLUMN arena_updated_at DATETIME NULL AFTER arena_deaths;
