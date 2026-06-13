import {Args, Command, Flags} from '@oclif/core'

import {agentFlags, buildSelectOptions, printJson, queryFlags, withAgent} from '../../services/agent/command.js'

export default class AgentRelation extends Command {
  static args = {
    collection: Args.string({description: 'Parent collection', required: true}),
    id: Args.string({description: 'Parent record id', required: true}),
    relation: Args.string({description: 'Relation field name', required: true}),
  }

  static description = 'List (or count) records related through a relation.'

  static examples = [
    '<%= config.bin %> agent relation customers 1 orders --project-dir ./my-project',
    '<%= config.bin %> agent relation customers 1 orders --count',
  ]

  static flags = {
    ...agentFlags,
    ...queryFlags,
    count: Flags.boolean({default: false, description: 'Count instead of listing'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AgentRelation)

    await withAgent(this, flags, async agent => {
      const relation = agent.collection(args.collection).relation(args.relation, args.id)

      if (flags.count) {
        const count = await relation.count(buildSelectOptions(flags, {paginate: false}))
        printJson(this, {count})

        return
      }

      const records = await relation.list(buildSelectOptions(flags))
      printJson(this, records)
    })
  }
}
