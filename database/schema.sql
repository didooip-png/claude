-- =====================================================================
--  Quiz SES — Schéma de la base de données (MySQL 5.7+ / MariaDB 10.3+)
--  À importer en premier (phpMyAdmin > Importer, ou : mysql nom_base < schema.sql)
--
--  Compte professeure créé automatiquement :
--     identifiant : cyrine
--     mot de passe provisoire : ChangeMoi2026!
--  (le site oblige à le changer à la première connexion)
-- =====================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS classes (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(60)  NOT NULL,
  created_at  INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_class_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  role                  ENUM('student','teacher') NOT NULL DEFAULT 'student',
  login_key             VARCHAR(130) NOT NULL,
  first_name            VARCHAR(60)  NOT NULL,
  last_name             VARCHAR(60)  NOT NULL DEFAULT '',
  password_hash         VARCHAR(255) NOT NULL,
  class_id              INT UNSIGNED NULL,
  status                ENUM('pending','active','disabled') NOT NULL DEFAULT 'active',
  must_change_password  TINYINT(1)   NOT NULL DEFAULT 0,
  session_token         CHAR(64)     NULL,
  created_at            INT UNSIGNED NOT NULL,
  last_login_at         INT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_login (role, login_key),
  KEY idx_class (class_id),
  CONSTRAINT fk_user_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  name   VARCHAR(60) NOT NULL,
  value  TEXT        NOT NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ip            VARCHAR(45)  NOT NULL,
  login_key     VARCHAR(130) NOT NULL,
  attempted_at  INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ip_time (ip, attempted_at),
  KEY idx_key_time (login_key, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quizzes (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title               VARCHAR(200) NOT NULL,
  description         TEXT         NULL,
  level               VARCHAR(30)  NOT NULL DEFAULT '',
  chapter             VARCHAR(200) NOT NULL DEFAULT '',
  status              ENUM('draft','open','closed','archived') NOT NULL DEFAULT 'draft',
  access_code         VARCHAR(12)  NULL,
  opens_at            INT UNSIGNED NULL,
  closes_at           INT UNSIGNED NULL,
  max_attempts        TINYINT UNSIGNED NOT NULL DEFAULT 1,
  time_limit          INT UNSIGNED NOT NULL DEFAULT 0,
  shuffle_questions   TINYINT(1)   NOT NULL DEFAULT 1,
  shuffle_choices     TINYINT(1)   NOT NULL DEFAULT 1,
  pool_size           INT UNSIGNED NOT NULL DEFAULT 0,
  feedback_mode       ENUM('immediate','end','release') NOT NULL DEFAULT 'release',
  results_released    TINYINT(1)   NOT NULL DEFAULT 0,
  show_leaderboard    TINYINT(1)   NOT NULL DEFAULT 1,
  speed_bonus         TINYINT(1)   NOT NULL DEFAULT 1,
  require_fullscreen  TINYINT(1)   NOT NULL DEFAULT 1,
  max_exits           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  exit_action         ENUM('lock','submit','log') NOT NULL DEFAULT 'lock',
  allowed_ips         VARCHAR(500) NULL,
  created_at          INT UNSIGNED NOT NULL,
  updated_at          INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quiz_classes (
  quiz_id   INT UNSIGNED NOT NULL,
  class_id  INT UNSIGNED NOT NULL,
  PRIMARY KEY (quiz_id, class_id),
  KEY idx_class (class_id),
  CONSTRAINT fk_qc_quiz  FOREIGN KEY (quiz_id)  REFERENCES quizzes (id) ON DELETE CASCADE,
  CONSTRAINT fk_qc_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS questions (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  quiz_id      INT UNSIGNED NOT NULL,
  position     INT UNSIGNED NOT NULL DEFAULT 0,
  type         ENUM('single','multiple','truefalse','short','numeric','ordering') NOT NULL,
  prompt       TEXT         NOT NULL,
  image        VARCHAR(100) NULL,
  data         MEDIUMTEXT   NOT NULL,
  points       DECIMAL(6,2) NOT NULL DEFAULT 1.00,
  time_limit   INT UNSIGNED NOT NULL DEFAULT 30,
  partial      TINYINT(1)   NOT NULL DEFAULT 0,
  explanation  TEXT         NULL,
  created_at   INT UNSIGNED NOT NULL,
  updated_at   INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY idx_quiz_pos (quiz_id, position),
  CONSTRAINT fk_question_quiz FOREIGN KEY (quiz_id) REFERENCES quizzes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attempts (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  quiz_id         INT UNSIGNED NOT NULL,
  user_id         INT UNSIGNED NOT NULL,
  attempt_no      TINYINT UNSIGNED NOT NULL DEFAULT 1,
  is_preview      TINYINT(1)   NOT NULL DEFAULT 0,
  status          ENUM('in_progress','locked','finished') NOT NULL DEFAULT 'in_progress',
  finish_reason   VARCHAR(20)  NULL,
  lock_reason     VARCHAR(160) NULL,
  question_ids    TEXT         NOT NULL,
  choice_orders   MEDIUMTEXT   NOT NULL,
  current_index   INT UNSIGNED NOT NULL DEFAULT 0,
  q_started_ms    BIGINT UNSIGNED NULL,
  started_ms      BIGINT UNSIGNED NOT NULL,
  deadline_ms     BIGINT UNSIGNED NULL,
  finished_ms     BIGINT UNSIGNED NULL,
  last_seen_ms    BIGINT UNSIGNED NOT NULL,
  score           DECIMAL(8,2) NOT NULL DEFAULT 0,
  max_score       DECIMAL(8,2) NOT NULL DEFAULT 0,
  points          INT UNSIGNED NOT NULL DEFAULT 0,
  zeroed          TINYINT(1)   NOT NULL DEFAULT 0,
  warning_text    VARCHAR(300) NULL,
  warning_ms      BIGINT UNSIGNED NULL,
  exits           INT UNSIGNED NOT NULL DEFAULT 0,
  incidents       INT UNSIGNED NOT NULL DEFAULT 0,
  away_ms         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  session_token   CHAR(64)     NOT NULL,
  ip              VARCHAR(45)  NULL,
  device          VARCHAR(40)  NULL,
  user_agent      VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_quiz_user (quiz_id, user_id),
  KEY idx_user (user_id),
  KEY idx_status (status),
  CONSTRAINT fk_attempt_quiz FOREIGN KEY (quiz_id) REFERENCES quizzes (id) ON DELETE CASCADE,
  CONSTRAINT fk_attempt_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS answers (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  attempt_id      INT UNSIGNED NOT NULL,
  question_id     INT UNSIGNED NOT NULL,
  position        INT UNSIGNED NOT NULL,
  response        TEXT         NULL,
  status          ENUM('answered','timeout','cancelled') NOT NULL DEFAULT 'answered',
  fraction        DECIMAL(5,4) NOT NULL DEFAULT 0,
  score           DECIMAL(6,2) NOT NULL DEFAULT 0,
  override_score  DECIMAL(6,2) NULL,
  points          INT UNSIGNED NOT NULL DEFAULT 0,
  time_ms         INT UNSIGNED NULL,
  created_ms      BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attempt_question (attempt_id, question_id),
  KEY idx_question (question_id),
  CONSTRAINT fk_answer_attempt  FOREIGN KEY (attempt_id)  REFERENCES attempts (id)  ON DELETE CASCADE,
  CONSTRAINT fk_answer_question FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS incidents (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  attempt_id      INT UNSIGNED NOT NULL,
  type            VARCHAR(30)  NOT NULL,
  detail          VARCHAR(255) NULL,
  question_index  INT          NULL,
  duration_ms     INT UNSIGNED NULL,
  counted         TINYINT(1)   NOT NULL DEFAULT 0,
  exit_key        VARCHAR(40)  NULL,
  created_ms      BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_exit (attempt_id, exit_key),
  KEY idx_attempt (attempt_id, created_ms),
  CONSTRAINT fk_incident_attempt FOREIGN KEY (attempt_id) REFERENCES attempts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NULL,
  action      VARCHAR(40)  NOT NULL,
  detail      VARCHAR(255) NULL,
  ip          VARCHAR(45)  NULL,
  created_at  INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY idx_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Réglages par défaut
-- ---------------------------------------------------------------------
INSERT IGNORE INTO settings (name, value) VALUES
  ('site_name', 'Quiz SES'),
  ('teacher_name', 'Mme Cyrine'),
  ('allow_registration', '1'),
  ('require_validation', '1');

-- ---------------------------------------------------------------------
--  Compte professeure (mot de passe provisoire : ChangeMoi2026!)
-- ---------------------------------------------------------------------
INSERT IGNORE INTO users (role, login_key, first_name, last_name, password_hash, status, must_change_password, created_at)
VALUES ('teacher', 'cyrine', 'Cyrine', '', '$2y$12$OfQU.PDrGhV75kpUvFinzuKMrVfUjK4jq8DKcwZDatqFm1bQBfdxe', 'active', 1, UNIX_TIMESTAMP());
