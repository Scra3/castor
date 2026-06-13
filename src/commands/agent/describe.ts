import {Args, Command} from '@oclif/core'

import {agentFlags, printJson, withAgent} from '../../services/agent/command.js'
import {fetchDomains} from '../../services/layout/fetch.js'

export default class AgentDescribe extends Command {
  static args = {
    collection: Args.string({description: 'Collection to describe (otherwise lists all collections)'}),
  }

  static description = 'Describe the agent: list collections, or a collection’s fields/types/operators.'

  static examples = ['<%= config.bin %> agent describe --project-dir ./my-project', '<%= config.bin %> agent describe customers']

  static flags = {...agentFlags}

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AgentDescribe)

    await withAgent(this, flags, async (agent, ctx) => {
      if (args.collection) {
        const capabilities = await agent.collection(args.collection).capabilities()
        printJson(this, capabilities)

        return
      }

      // No collection: list the collection names from the Forest layout (rendering).
      const docs = await fetchDomains(ctx.client, ctx.scope, ['layout'])
      const layout = docs.layout as {collections?: Array<{id: string}>} | undefined
      const names = (layout?.collections ?? []).map(collection => collection.id)
      printJson(this, {collections: names})
    })
  }
}
