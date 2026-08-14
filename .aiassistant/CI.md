# CI Conventions (v1.0.0)

Nextcloud‑specific CI conventions for the `nextcloud/setup-server-action@v0.5.0` action.

## Contents

1. Setup‑Server‑Action
2. Database Configuration
3. App Injection
4. PHPUnit in CI
5. Document Governance

## 1. Setup‑Server‑Action

- Action: `nextcloud/setup-server-action@v0.5.0` (official, under `nextcloud` org)
- Creates server in `nextcloud/` subdirectory — NOT workspace root
- All app paths must target `nextcloud/apps/<app_id>/`
- Use `working-directory` instead of inline `cd`

## 2. Database Configuration

- Default: `database: sqlite`
- For MariaDB/MySQL apps, set `database: mysql`
- Action hardcodes DB credentials: user `nextcloud`, password `nextcloud`, host `127.0.0.1`
  → MariaDB service MUST provide `MYSQL_USER: nextcloud`, `MYSQL_PASSWORD: nextcloud`
- Do NOT pass `database-host`, `database-name`, `database-user`, `database-pass` — these are not recognized inputs by the action

## 3. App Injection

- Use `rsync -a --exclude='.git' --exclude='nextcloud' ./ nextcloud/apps/<app_id>/`
- The `--exclude='nextcloud'` prevents recursive copy into the server directory
- Run `php occ app:enable <app_id>` after injection to run migrations (both PHPUnit and Cypress jobs)

## 4. PHPUnit in CI

- Run from app directory: `working-directory: nextcloud/apps/<app_id>`
- Command: `./vendor/bin/phpunit -c tests/phpunit.xml --display-warnings`
- On PHP 8.4 with PHPUnit 10.5: suppress `E_STRICT` deprecations via `php -d error_reporting='E_ALL & ~E_DEPRECATED'`
- See also: [`.aiassistant/TESTING.md`](TESTING.md) §1 for `--display-warnings` rationale

## 5. Document Governance

- Version updates follow `.aiassistant/CHANGELOG.md` rules.
