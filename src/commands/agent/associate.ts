import {Args, Command} from '@oclif/core'

import {agentFlags, withAgent} from '../../services/agent/command.js'
import {AgentError} from '../../services/agent/errors.js'

export default class AgentAssociate extends Command {
  static args = {
    collection: Args.string({description: 'Parent collection', required: true}),
    id: Args.string({description: 'Parent record id', required: true}),
    relation: Args.string({description: 'Relation field name', required: true}),
    targetIds: Args.string({description: 'Id(s) to associate, comma-separated', required: true}),
  }

  static description = 'Associate one or more records to a relation.'

  static examples = ['<%= config.bin %> agent associate customers 1 orders 5,6 --project-dir ./my-project']

  static flags = {...agentFlags}

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AgentAssociate)
    const targetIds = args.targetIds.split(',').map(id => id.trim()).filter(Boolean)
    if (targetIds.length === 0) throw new AgentError('No target id provided.')

    await withAgent(this, flags, async agent => {
      const relation = agent.collection(args.collection).relation(args.relation, args.id)
      // associate() takes a single target — apply it for each id.
      for (const targetId of targetIds) {
        // eslint-disable-next-line no-await-in-loop
        await relation.associate(targetId)
      }

      this.log(`✓ ${targetIds.length} record(s) associated to ${args.collection}#${args.id}.${args.relation}.`)
    })
  }
}
