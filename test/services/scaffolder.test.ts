import {expect} from 'chai'
import {readFile, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ScaffoldOptions} from '../../src/services/scaffolder.js'

import {buildAgentProjectFiles, writeAgentProject} from '../../src/services/scaffolder.js'

const baseOptions: ScaffoldOptions = {
  agentPort: 3310,
  authSecret: 'auth-secret-123',
  databaseUrl: 'postgres://postgres:forest@localhost:5446/sample',
  envSecret: 'env-secret-456',
  name: 'my-agent',
}

describe('scaffolder.buildAgentProjectFiles', () => {
  it('generates exactly the five expected files', () => {
    const files = buildAgentProjectFiles(baseOptions)
    expect(Object.keys(files).sort()).to.deep.equal(['.env', '.gitignore', 'README.md', 'index.js', 'package.json'])
  })

  it('produces a valid package.json with the agent deps and start script', () => {
    const pkg = JSON.parse(buildAgentProjectFiles(baseOptions)['package.json'])
    expect(pkg.name).to.equal('my-agent')
    expect(pkg.scripts.start).to.equal('node index.js')
    expect(pkg.dependencies).to.have.keys(['@forestadmin/agent', '@forestadmin/datasource-sql', 'dotenv', 'pg'])
  })

  it('writes the secrets and database URL into .env', () => {
    const env = buildAgentProjectFiles(baseOptions)['.env']
    expect(env).to.contain('FOREST_AUTH_SECRET=auth-secret-123')
    expect(env).to.contain('FOREST_ENV_SECRET=env-secret-456')
    expect(env).to.contain('DATABASE_URL=postgres://postgres:forest@localhost:5446/sample')
    expect(env).to.contain('AGENT_PORT=3310')
  })

  it('omits FOREST_SERVER_URL when targeting the default server', () => {
    expect(buildAgentProjectFiles(baseOptions)['.env']).to.not.contain('FOREST_SERVER_URL')
  })

  it('includes FOREST_SERVER_URL when a custom server is given', () => {
    const env = buildAgentProjectFiles({...baseOptions, serverUrl: 'http://localhost:3001'})['.env']
    expect(env).to.contain('FOREST_SERVER_URL=http://localhost:3001')
  })

  it('gitignores the .env file (security)', () => {
    expect(buildAgentProjectFiles(baseOptions)['.gitignore']).to.contain('.env')
  })

  it('references the agent port in index.js', () => {
    expect(buildAgentProjectFiles(baseOptions)['index.js']).to.contain('3310')
  })

  it('reads WORKFLOW_EXECUTOR_URL in index.js and omits it from .env by default', () => {
    const files = buildAgentProjectFiles(baseOptions)
    expect(files['index.js']).to.contain('workflowExecutorUrl: process.env.WORKFLOW_EXECUTOR_URL')
    expect(files['.env']).to.not.contain('WORKFLOW_EXECUTOR_URL')
  })

  it('writes WORKFLOW_EXECUTOR_URL into .env when provided', () => {
    const env = buildAgentProjectFiles({...baseOptions, workflowExecutorUrl: 'http://localhost:3400'})['.env']
    expect(env).to.contain('WORKFLOW_EXECUTOR_URL=http://localhost:3400')
  })
})

describe('scaffolder.writeAgentProject', () => {
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `forest-onboard-scaffold-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  })

  afterEach(async () => {
    await rm(dir, {force: true, recursive: true})
  })

  it('writes all files to disk', async () => {
    await writeAgentProject(dir, baseOptions)

    await stat(join(dir, 'package.json')) // throws if missing
    const env = await readFile(join(dir, '.env'), 'utf8')
    expect(env).to.contain('FOREST_ENV_SECRET=env-secret-456')
  })
})
