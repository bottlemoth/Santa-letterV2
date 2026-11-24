/* eslint-disable camelcase */
// Migracja początkowa: pełny schemat Santa Letter.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE group_kind AS ENUM ('family', 'friends');
    CREATE TYPE member_role AS ENUM ('admin', 'member');
    CREATE TYPE occasion_type AS ENUM ('christmas', 'birthday', 'anniversary', 'other');
    CREATE TYPE list_status AS ENUM ('active', 'archived');
    CREATE TYPE list_mode AS ENUM ('standard', 'surprise');
    CREATE TYPE item_priority AS ENUM ('low', 'medium', 'high');

    -- Użytkownicy ---------------------------------------------------------
    CREATE TABLE users (
      id            BIGSERIAL PRIMARY KEY,
      name          VARCHAR(80)  NOT NULL,
      email         VARCHAR(254) NOT NULL,
      password_hash VARCHAR(100) NOT NULL,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
      CONSTRAINT users_email_lowercase CHECK (email = lower(email))
    );
    CREATE UNIQUE INDEX users_email_unique ON users (email);

    -- Grupy + kody zaproszeń ---------------------------------------------
    CREATE TABLE groups (
      id          BIGSERIAL PRIMARY KEY,
      name        VARCHAR(80)  NOT NULL,
      description VARCHAR(500),
      kind        group_kind   NOT NULL DEFAULT 'family',
      invite_code VARCHAR(16)  NOT NULL,
      invite_code_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX groups_invite_code_unique ON groups (invite_code);

    -- Członkostwa i role (rola 'admin' = właściciel grupy; dokładnie jeden na grupę)
    CREATE TABLE group_members (
      group_id  BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id   BIGINT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
      role      member_role NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, user_id)
    );
    CREATE INDEX group_members_user_idx ON group_members (user_id);
    CREATE UNIQUE INDEX group_members_one_admin ON group_members (group_id) WHERE role = 'admin';

    -- Listy prezentowe ----------------------------------------------------
    CREATE TABLE gift_lists (
      id             BIGSERIAL PRIMARY KEY,
      owner_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name           VARCHAR(120) NOT NULL,
      occasion       occasion_type NOT NULL DEFAULT 'christmas',
      occasion_label VARCHAR(80),
      description    VARCHAR(1000),
      event_date     DATE,
      status         list_status NOT NULL DEFAULT 'active',
      mode           list_mode   NOT NULL DEFAULT 'standard',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX gift_lists_owner_idx ON gift_lists (owner_id);
    CREATE INDEX gift_lists_event_date_idx ON gift_lists (event_date) WHERE status = 'active';

    -- Pozycje prezentowe --------------------------------------------------
    CREATE TABLE gift_items (
      id         BIGSERIAL PRIMARY KEY,
      list_id    BIGINT NOT NULL REFERENCES gift_lists(id) ON DELETE CASCADE,
      name       VARCHAR(200) NOT NULL,
      url        VARCHAR(2048),
      image_path VARCHAR(100),
      image_url  VARCHAR(2048),
      notes      VARCHAR(1000),
      price      NUMERIC(10, 2) CHECK (price IS NULL OR price >= 0),
      currency   CHAR(3) NOT NULL DEFAULT 'PLN',
      priority   item_priority NOT NULL DEFAULT 'medium',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX gift_items_list_idx ON gift_items (list_id);

    -- Dane trybu niespodzianki (1:1 z listą) ------------------------------
    CREATE TABLE surprise_profiles (
      list_id     BIGINT PRIMARY KEY REFERENCES gift_lists(id) ON DELETE CASCADE,
      interests   VARCHAR(1000),
      categories  VARCHAR(1000),
      preferences VARCHAR(1000),
      sizes       VARCHAR(500),
      budget_min  NUMERIC(10, 2) CHECK (budget_min IS NULL OR budget_min >= 0),
      budget_max  NUMERIC(10, 2) CHECK (budget_max IS NULL OR budget_max >= 0),
      currency    CHAR(3) NOT NULL DEFAULT 'PLN',
      dislikes    VARCHAR(1000),
      notes       VARCHAR(1000),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Tajne pomysły (autor = automatycznie zaklepujący) --------------------
    CREATE TABLE secret_ideas (
      id           BIGSERIAL PRIMARY KEY,
      list_id      BIGINT NOT NULL REFERENCES gift_lists(id) ON DELETE CASCADE,
      author_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         VARCHAR(200) NOT NULL,
      url          VARCHAR(2048),
      image_path   VARCHAR(100),
      image_url    VARCHAR(2048),
      private_note VARCHAR(1000),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX secret_ideas_list_idx ON secret_ideas (list_id);
    CREATE INDEX secret_ideas_author_idx ON secret_ideas (author_id);

    -- Rezerwacje: UNIQUE(item_id) => maksymalnie jedna aktywna rezerwacja,
    -- atomowo egzekwowane przez bazę także przy równoległych żądaniach.
    CREATE TABLE reservations (
      id          BIGSERIAL PRIMARY KEY,
      item_id     BIGINT NOT NULL REFERENCES gift_items(id) ON DELETE CASCADE,
      reserver_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT reservations_item_unique UNIQUE (item_id)
    );
    CREATE INDEX reservations_reserver_idx ON reservations (reserver_id);

    -- Powiadomienia ---------------------------------------------------------
    CREATE TABLE notifications (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       VARCHAR(40) NOT NULL,
      message    VARCHAR(500) NOT NULL,
      link       VARCHAR(200),
      dedupe_key VARCHAR(120),
      read_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
    CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
    CREATE UNIQUE INDEX notifications_dedupe_unique ON notifications (user_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL;

    -- Sesje (connect-pg-simple) ------------------------------------------
    CREATE TABLE "session" (
      "sid"    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
      "sess"   JSON NOT NULL,
      "expire" TIMESTAMP(6) NOT NULL
    );
    CREATE INDEX "IDX_session_expire" ON "session" ("expire");
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS "session", notifications, reservations, secret_ideas,
      surprise_profiles, gift_items, gift_lists, group_members, groups, users CASCADE;
    DROP TYPE IF EXISTS item_priority, list_mode, list_status, occasion_type, member_role, group_kind;
  `);
};
