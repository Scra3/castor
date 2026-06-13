import {Command} from '@oclif/core'

import {ensureLoggedIn} from '../../services/auth.js'
import {applyInsecure, makeClient} from '../../services/cli-helpers.js'
import {fetchDomains} from '../../services/layout/fetch.js'
import {ScopeError, resolveScope} from '../../services/layout/scope.js'
import {realPrompts, realSelect} from '../../services/prompts.js'
import {printJson, workflowFlags} from '../../services/workflow/command.js'

export default class WorkflowList extends Command {
  static description = 'List the workflow definitions of the scope (to get a --workflow id for `workflow start`).'

  static examples = ['<%= config.bin %> workflow list --project "My Project"']

  static flags = {...workflowFlags}

  async run(): Promise<void> {
    const {flags} = await this.parse(WorkflowList)
    const interactive = !flags.yes && Boolean(process.stdout.isTTY)
    applyInsecure(flags.insecure, m => this.warn(m))
    const {client, serverUrl} = makeClient(flags, m => this.log(m))

    try {
      await ensureLoggedIn({client, interactive, log: m => this.log(m), oauth: flags.oauth, prompts: realPrompts, serverUrl})
      const scope = await resolveScope({
        client,
        flags: {env: flags.env, project: flags.project, team: flags.team},
        interactive,
        prompts: {select: realSelect},
        serverUrl,
      })

      const docs = await fetchDomains(client, scope, ['workflows'])
      printJson(this, docs.workflows ?? [])
    } catch (error) {
      if (error instanceof ScopeError) this.error(error.message)
      throw error
    }
  }
}
