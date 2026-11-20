-- Fight tokens: entering the Boxing Ring or the Sword Arena costs tokens. Every account starts
-- with 3 free ones (existing accounts get them when this runs); more are bought through PayHere.
ALTER TABLE users ADD COLUMN tokens INT UNSIGNED NOT NULL DEFAULT 3 AFTER character_id;

-- Every change to a balance, for support questions and refunds.
CREATE TABLE token_ledger (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  delta INT NOT NULL,
  reason ENUM('signup', 'purchase', 'fight', 'chargeback', 'admin') NOT NULL,
  ref VARCHAR(64) NULL,
  balance INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_ledger_user (user_id, created_at),
  CONSTRAINT fk_ledger_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Token packs bought through PayHere. The order id is ours (random); PayHere's own id arrives with the payment.
CREATE TABLE payments (
  order_id VARCHAR(32) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  pack VARCHAR(16) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'LKR',
  tokens INT UNSIGNED NOT NULL,
  status ENUM('pending', 'paid', 'failed', 'cancelled', 'chargedback') NOT NULL DEFAULT 'pending',
  payhere_payment_id VARCHAR(32) NULL,
  method VARCHAR(16) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_payments_user (user_id, created_at),
  CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
