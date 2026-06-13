import {Args, Command, Flags} from '@oclif/core'

import {agentFlags, buildSelectOptions, printJson, withAgent} from '../../services/agent/command.js'

export default class AgentCount extends Command {
  static args = {
    collection: Args.string({description: 'Collection to count', required: true}),
  }

  static description = 'Count records of a collection (optional filter/search/segment).'

  static examples = ['<%= config.bin %> agent count customers --project-dir ./my-project']

  static flags = {
    ...agentFlags,
    filter: Flags.string({description: 'Filter: JSON condition tree'}),
    search: Flags.string({description: 'Full-text search'}),
    segment: Flags.string({description: 'Count through an existing segment (by name)'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AgentCount)

    await withAgent(this, flags, async agent => {
      const collection = agent.collection(args.collection)
      const options = buildSelectOptions(flags, {paginate: false})

      let count: number
      if (flags.segment) {
        // Segments don't expose count(); fall back to listing then measuring.
        const records = await collection.segment(flags.segment).list(options)
        count = records.length
      } else {
        count = await collection.count(options)
      }

      printJson(this, {count})
    })
  }
}
