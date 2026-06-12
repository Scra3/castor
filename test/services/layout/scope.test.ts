import {expect} from 'chai'

import type {ForestApiClient} from '../../../src/services/api-client.js'

import {ScopeError, resolveScope} from '../../../src/services/layout/scope.js'

type Lists = {
  environments?: Array<{id: string; name: string; type?: string}>
  projects?: Array<{id: string; name: string}>
  teams?: Array<{id: string; name: string}>
}

function fakeClient(lists: Lists): ForestApiClient {
  return {
    listEnvironments: () => Promise.resolve(lists.environments ?? []),
    listProjects: () => Promise.resolve(lists.projects ?? []),
    listTeams: () => Promise.resolve(lists.teams ?? []),
  } as unknown as ForestApiClient
}

const noSelect = {
  select: () => Promise.reject(new Error('should not prompt')),
}

const base = {
  environments: [{id: '34', name: 'Development', type: 'development'}, {id: '35', name: 'Production', type: 'production'}],
  projects: [{id: '12', name: 'My Project'}],
  teams: [{id: '56', name: 'Operations'}, {id: '57', name: 'Sales'}],
}

describe('layout/scope.resolveScope', () => {
  it('auto-selects a single project, the development env and the Operations team', async () => {
    const scope = await resolveScope({
      client: fakeClient(base),
      flags: {},
      interactive: false,
      prompts: noSelect,
      serverUrl: 'http://localhost:3001',
    })

    expect(scope).to.deep.equal({
      environmentId: 34,
      environmentName: 'Development',
      projectId: 12,
      projectName: 'My Project',
      serverUrl: 'http://localhost:3001',
      teamId: 56,
      teamName: 'Operations',
    })
  })

  it('matches flags by name (case-insensitive) and by id', async () => {
    const scope = await resolveScope({
      client: fakeClient(base),
      flags: {env: 'production', team: '57'},
      interactive: false,
      prompts: noSelect,
      serverUrl: 's',
    })

    expect(scope.environmentName).to.equal('Production')
    expect(scope.teamId).to.equal(57)
  })

  it('lists the available values when a flag matches nothing', async () => {
    try {
      await resolveScope({client: fakeClient(base), flags: {project: 'nope'}, interactive: false, prompts: noSelect, serverUrl: 's'})
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(ScopeError)
      expect((error as ScopeError).message).to.contain('My Project')
    }
  })

  it('reuses the file header ids without prompting', async () => {
    const scope = await resolveScope({
      client: fakeClient(base),
      flags: {},
      fromFile: {environmentId: 35, projectId: 12, teamId: 57},
      interactive: false,
      prompts: noSelect,
      serverUrl: 's',
    })

    expect(scope.environmentId).to.equal(35)
    expect(scope.teamId).to.equal(57)
  })

  it('falls back to normal resolution when the header points at a gone id', async () => {
    const scope = await resolveScope({
      client: fakeClient(base),
      flags: {},
      fromFile: {environmentId: 999, projectId: 12, teamId: 56},
      interactive: false,
      prompts: noSelect,
      serverUrl: 's',
    })

    expect(scope.environmentId).to.equal(34) // development default
  })

  it('fails with an actionable error in non-interactive ambiguity', async () => {
    const lists = {...base, teams: [{id: '1', name: 'A'}, {id: '2', name: 'B'}]}

    try {
      await resolveScope({client: fakeClient(lists), flags: {}, interactive: false, prompts: noSelect, serverUrl: 's'})
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(ScopeError)
      expect((error as ScopeError).message).to.contain('--team')
    }
  })

  it('prompts interactively when ambiguous', async () => {
    const lists = {...base, teams: [{id: '1', name: 'A'}, {id: '2', name: 'B'}]}
    const scope = await resolveScope({
      client: fakeClient(lists),
      flags: {},
      interactive: true,
      prompts: {select: (_m, choices) => Promise.resolve(choices[1].value)},
      serverUrl: 's',
    })

    expect(scope.teamName).to.equal('B')
  })
})
