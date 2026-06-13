import {Args, Command} from '@oclif/core'

import {agentFlags, withAgent} from '../../services/agent/command.js'
import {AgentError} from '../../services/agent/errors.js'

export default class AgentDissociate extends Command {
  static args = {
    collection: Args.string({description: 'Parent collection', required: true}),
    id: Args.string({description: 'Parent record id', required: true}),
    relation: Args.string({description: 'Relation field name', required: true}),
    targetIds: Args.string({description: 'Id(s) to dissociate, comma-separated', required: true}),
  }

  static description = 'Dissociate one or more records from a relation.'

  static examples = ['<%= config.bin %> agent dissociate customers 1 orders 5,6 --project-dir ./my-project']

  static flags = {...agentFlags}

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AgentDissociate)
    const targetIds = args.targetIds.split(',').map(id => id.trim()).filter(Boolean)
    if (targetIds.length === 0) throw new AgentError('No target id provided.')

    await withAgent(this, flags, async agent => {
      await agent.collection(args.collection).relation(args.relation, args.id).dissociate(targetIds)
      this.log(`✓ ${targetIds.length} record(s) dissociated from ${args.collection}#${args.id}.${args.relation}.`)
    })
  }
}
