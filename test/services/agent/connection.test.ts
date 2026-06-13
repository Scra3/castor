import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {resolveAgentConnection} from '../../../src/services/agent/connection.js'
import {AgentError} from '../../../src/services/agent/errors.js'

describe('agent/connection.resolveAgentConnection', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-conn-'))
  })

  afterEach(async () => {
    await rm(dir, {force: true, recursive: true})
  })

  it('reads authSecret and AGENT_PORT from the project .env', async () => {
    await writeFile(join(dir, '.env'), 'FOREST_AUTH_SECRET=from-file\nAGENT_PORT=4242\n')

    const conn = await resolveAgentConnection({'project-dir': dir}, {})

    expect(conn.authSecret).to.equal('from-file')
    expect(conn.agentUrl).to.equal('http://localhost:4242')
  })

  it('prefers --auth-secret over env over .env', async () => {
    await writeFile(join(dir, '.env'), 'FOREST_AUTH_SECRET=from-file\n')

    const conn = await resolveAgentConnection(
      {'auth-secret': 'from-flag', 'project-dir': dir},
      {FOREST_AUTH_SECRET: 'from-env'},
    )

    expect(conn.authSecret).to.equal('from-flag')
  })

  it('falls back to $FOREST_AUTH_SECRET and default port 3310', async () => {
    const conn = await resolveAgentConnection({}, {FOREST_AUTH_SECRET: 'from-env'})

    expect(conn.authSecret).to.equal('from-env')
    expect(conn.agentUrl).to.equal('http://localhost:3310')
  })

  it('uses the agent ROOT url, stripping any trailing /forest and slash', async () => {
    const a = await resolveAgentConnection({'agent-url': 'http://host:9/forest/', 'auth-secret': 's'}, {})
    const b = await resolveAgentConnection({'agent-url': 'http://host:9/', 'auth-secret': 's'}, {})

    expect(a.agentUrl).to.equal('http://host:9')
    expect(b.agentUrl).to.equal('http://host:9')
  })

  it('throws AgentError when no authSecret can be found', async () => {
    try {
      await resolveAgentConnection({}, {})
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(AgentError)
      expect((error as AgentError).message).to.contain('FOREST_AUTH_SECRET')
    }
  })

  it('throws AgentError when --project-dir has no readable .env', async () => {
    try {
      await resolveAgentConnection({'project-dir': join(dir, 'missing')}, {})
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(AgentError)
    }
  })
})
