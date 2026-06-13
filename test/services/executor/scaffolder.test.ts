import {expect} from 'chai'

import {EXECUTOR_PACKAGE_VERSION, buildExecutorProjectFiles} from '../../../src/services/executor/scaffolder.js'

const baseOptions = {
  agentUrl: 'http://localhost:3310',
  authSecret: 'auth-secret-123',
  databaseUrl: 'postgres://postgres:forest@localhost:5446/sample',
  envSecret: 'env-secret-456',
  httpPort: 3400,
  name: 'my-agent',
}

describe('executor/scaffolder.buildExecutorProjectFiles', () => {
  it('generates exactly the four expected files', () => {
    const files = buildExecutorProjectFiles(baseOptions)
    expect(Object.keys(files).sort()).to.deep.equal(['.env', '.gitignore', 'README.md', 'package.json'])
  })

  it('writes the required env vars (secrets, agent url, port)', () => {
    const env = buildExecutorProjectFiles(baseOptions)['.env']
    expect(env).to.contain('FOREST_AUTH_SECRET=auth-secret-123')
    expect(env).to.contain('FOREST_ENV_SECRET=env-secret-456')
    expect(env).to.contain('AGENT_URL=http://localhost:3310')
    expect(env).to.contain('HTTP_PORT=3400')
    expect(env).to.contain('DATABASE_URL=postgres://postgres:forest@localhost:5446/sample')
  })

  it('omits DATABASE_URL when no database is provided (in-memory)', () => {
    const env = buildExecutorProjectFiles({...baseOptions, databaseUrl: undefined})['.env']
    expect(env).to.not.contain('DATABASE_URL=')
  })

  it('omits FOREST_SERVER_URL by default and includes it when given', () => {
    expect(buildExecutorProjectFiles(baseOptions)['.env']).to.not.contain('FOREST_SERVER_URL')
    const env = buildExecutorProjectFiles({...baseOptions, serverUrl: 'http://localhost:3001'})['.env']
    expect(env).to.contain('FOREST_SERVER_URL=http://localhost:3001')
  })

  it('produces a package.json depending on the executor with start scripts and a Node engine floor', () => {
    const pkg = JSON.parse(buildExecutorProjectFiles(baseOptions)['package.json'])
    expect(pkg.name).to.equal('my-agent-workflow-executor')
    expect(pkg.dependencies['@forestadmin/workflow-executor']).to.equal(EXECUTOR_PACKAGE_VERSION)
    expect(pkg.scripts.start).to.contain('--env-file=.env')
    expect(pkg.scripts['start:memory']).to.contain('--in-memory')
    expect(pkg.engines.node).to.contain('22.12')
  })

  it('gitignores the .env file (security)', () => {
    expect(buildExecutorProjectFiles(baseOptions)['.gitignore']).to.contain('.env')
  })
})
