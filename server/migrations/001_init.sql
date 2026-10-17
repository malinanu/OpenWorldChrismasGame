-- Accounts: email+password now, phone+OTP in production. Username is set at sign-up (email)
-- or right after the first OTP login (phone), so it may briefly be NULL.
CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(16) NULL,
  email VARCHAR(254) NULL,
  password_hash VARCHAR(100) NULL,
  phone VARCHAR(20) NULL,
  phone_verified_at DATETIME NULL,
  character_id VARCHAR(32) NOT NULL DEFAULT 'Rogue_Hooded',
  role ENUM('player', 'admin') NOT NULL DEFAULT 'player',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NULL,
  banned_at DATETIME NULL,
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Opaque bearer tokens; only their SHA-256 is stored.
CREATE TABLE sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  user_agent VARCHAR(200) NULL,
  KEY ix_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE otp_codes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  ip VARCHAR(45) NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  KEY ix_otp_phone (phone, created_at),
  KEY ix_otp_ip (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Best result per user per mini-game; leaderboards are derived from it.
CREATE TABLE progress (
  user_id INT UNSIGNED NOT NULL,
  game_id VARCHAR(32) NOT NULL,
  best_score INT UNSIGNED NOT NULL DEFAULT 0,
  best_stars TINYINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, game_id),
  KEY ix_progress_game_score (game_id, best_score),
  CONSTRAINT fk_progress_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE stats (
  user_id INT UNSIGNED PRIMARY KEY,
  snowball_hits INT UNSIGNED NOT NULL DEFAULT 0,
  snowball_taken INT UNSIGNED NOT NULL DEFAULT 0,
  CONSTRAINT fk_stats_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
