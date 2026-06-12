/**
 * Resolves the database the generated agent connects to.
 *
 *   - When `--database-url` is given: validate it (Postgres only, v1) and use it.
 *   - Otherwise: provision a throwaway Postgres via docker compose, seeded with a
 *     small e-commerce schema, so onboarding works with zero prerequisites.
 */
import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {CommandRunner, runCommand} from './process-utils.js'

export const SAMPLE_DB_PORT = 5446
export const SAMPLE_DATABASE_URL = `postgres://postgres:forest@localhost:${SAMPLE_DB_PORT}/sample`

/** Raised for any database setup problem; message is user-facing and actionable. */
export class DatabaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseError'
  }
}

/** Validate a user-supplied connection string (Postgres only in v1). */
export function validateDatabaseUrl(url: string): string {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    throw new DatabaseError(`URL de base de données invalide : "${url}".`)
  }

  const protocol = parsed.protocol.replace(':', '')
  if (protocol !== 'postgres' && protocol !== 'postgresql') {
    throw new DatabaseError(
      `La v1 ne supporte que Postgres ; protocole reçu : "${protocol}". Fournis une URL postgres://...`,
    )
  }

  return url
}

/** docker-compose.yml for the throwaway sample Postgres. */
export function buildDockerComposeYml(port: number): string {
  return `services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: forest
      POSTGRES_DB: sample
    ports:
      - "${port}:5432"
    volumes:
      - ./seed.sql:/docker-entrypoint-initdb.d/seed.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d sample"]
      interval: 2s
      timeout: 5s
      retries: 15
`
}

/** Seed schema: a minimal e-commerce model with a couple of relationships. */
export function buildSeedSql(): string {
  return `CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO customers (email) VALUES
  ('alice@example.com'), ('bob@example.com'), ('carol@example.com'),
  ('dave@example.com'), ('erin@example.com');

INSERT INTO products (name, price) VALUES
  ('Notebook', 4.50), ('Pen', 1.20), ('Backpack', 39.90),
  ('Mug', 9.90), ('Desk lamp', 24.00);

INSERT INTO orders (customer_id, product_id, quantity) VALUES
  (1, 1, 3), (1, 2, 10), (2, 3, 1), (3, 4, 2), (4, 5, 1), (5, 1, 1);
`
}

export type ResolveDatabaseOptions = {
  /** When set, use this connection string instead of provisioning docker. */
  databaseUrl?: string
  /** User-facing progress log. */
  log?: (message: string) => void
  /** Injectable command runner (tests). Defaults to the real one. */
  run?: CommandRunner
  /** Directory under which the `sample-db/` folder is written. */
  targetDir: string
}

export type ResolveDatabaseResult = {
  /** Present only for the docker path: tears the container down. */
  cleanup?: () => Promise<void>
  databaseUrl: string
}

/** Resolve the database, provisioning a docker Postgres when no URL is given. */
export async function resolveDatabase(options: ResolveDatabaseOptions): Promise<ResolveDatabaseResult> {
  if (options.databaseUrl) {
    return {databaseUrl: validateDatabaseUrl(options.databaseUrl)}
  }

  const run = options.run ?? runCommand
  const log = options.log ?? (() => {})

  try {
    const info = await run('docker', ['info'])
    if (info.code !== 0) throw new DatabaseError('docker-not-running')
  } catch {
    throw new DatabaseError(
      'Docker indisponible. Démarre Docker, OU fournis une base existante avec --database-url postgres://...',
    )
  }

  const dbDir = join(options.targetDir, 'sample-db')
  await mkdir(dbDir, {recursive: true})
  await writeFile(join(dbDir, 'docker-compose.yml'), buildDockerComposeYml(SAMPLE_DB_PORT), 'utf8')
  await writeFile(join(dbDir, 'seed.sql'), buildSeedSql(), 'utf8')

  log('Démarrage d’une base Postgres d’exemple via Docker…')
  const up = await run('docker', ['compose', 'up', '-d', '--wait'], {cwd: dbDir})
  if (up.code !== 0) {
    throw new DatabaseError(`Échec du démarrage de la base Docker.\n${up.stderr || up.stdout}`)
  }

  return {
    async cleanup() {
      await run('docker', ['compose', 'down', '-v'], {cwd: dbDir})
    },
    databaseUrl: SAMPLE_DATABASE_URL,
  }
}
