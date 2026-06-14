import {expect} from 'chai'
import {readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {CommandResult} from '../../src/services/process-utils.js'

import {
  DatabaseError,
  SAMPLE_DATABASE_URL,
  buildDockerComposeYml,
  buildSeedSql,
  resolveDatabase,
  validateDatabaseUrl,
} from '../../src/services/database.js'

const throwingRun = async (): Promise<CommandResult> => {
  throw new Error('spawn docker ENOENT')
}

describe('database.validateDatabaseUrl', () => {
  it('accepts postgres and postgresql URLs', () => {
    expect(validateDatabaseUrl('postgres://u:p@host:5432/db')).to.equal('postgres://u:p@host:5432/db')
    expect(validateDatabaseUrl('postgresql://u:p@host:5432/db')).to.equal('postgresql://u:p@host:5432/db')
  })

  it('rejects non-postgres protocols', () => {
    expect(() => validateDatabaseUrl('mysql://u:p@host:3306/db')).to.throw(DatabaseError, /Postgres/)
  })

  it('rejects a malformed URL', () => {
    expect(() => validateDatabaseUrl('not a url')).to.throw(DatabaseError, /Invalid/)
  })
})

describe('database.buildDockerComposeYml', () => {
  it('maps the host port to 5432 and uses postgres:16 with a healthcheck', () => {
    const yml = buildDockerComposeYml(5446)
    expect(yml).to.contain('"5446:5432"')
    expect(yml).to.contain('image: postgres:16')
    expect(yml).to.contain('pg_isready')
  })
})

describe('database.buildSeedSql', () => {
  it('creates the three related tables with seed rows', () => {
    const sql = buildSeedSql()
    expect(sql).to.contain('CREATE TABLE customers')
    expect(sql).to.contain('CREATE TABLE products')
    expect(sql).to.contain('CREATE TABLE orders')
    expect(sql).to.contain('REFERENCES customers (id)')
    expect(sql).to.contain('INSERT INTO orders')
  })
})

describe('database.resolveDatabase', () => {
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `castor-db-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  })

  afterEach(async () => {
    await rm(dir, {force: true, recursive: true})
  })

  it('returns a provided URL without invoking docker', async () => {
    let called = false
    const run = async (): Promise<CommandResult> => {
      called = true

      return {code: 0, stderr: '', stdout: ''}
    }

    const result = await resolveDatabase({databaseUrl: 'postgres://u:p@h:5432/db', run, targetDir: dir})

    expect(result.databaseUrl).to.equal('postgres://u:p@h:5432/db')
    expect(result.cleanup).to.equal(undefined)
    expect(called).to.equal(false)
  })

  it('provisions docker and writes compose + seed files when no URL is given', async () => {
    const commands: string[] = []
    const run = async (command: string, args: string[]): Promise<CommandResult> => {
      commands.push(`${command} ${args.join(' ')}`)

      return {code: 0, stderr: '', stdout: ''}
    }

    const result = await resolveDatabase({run, targetDir: dir})

    expect(result.databaseUrl).to.equal(SAMPLE_DATABASE_URL)
    expect(result.cleanup).to.be.a('function')
    expect(commands).to.include('docker info')
    expect(commands.some(c => c.startsWith('docker compose up'))).to.equal(true)

    const yml = await readFile(join(dir, 'sample-db', 'docker-compose.yml'), 'utf8')
    expect(yml).to.contain('"5446:5432"')
  })

  it('throws an actionable error when docker is unavailable', async () => {
    try {
      await resolveDatabase({run: throwingRun, targetDir: dir})
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(DatabaseError)
      expect((error as DatabaseError).message).to.contain('--database-url')
    }
  })
})
