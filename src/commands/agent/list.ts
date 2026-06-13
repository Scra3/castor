import {Args, Command, Flags} from '@oclif/core'

import {agentFlags, buildSelectOptions, printJson, queryFlags, withAgent} from '../../services/agent/command.js'
import {AgentError} from '../../services/agent/errors.js'

export default class AgentList extends Command {
  static args = {
    collection: Args.string({description: 'Collection to list', required: true}),
  }

  static description = 'List records of a collection (filter, search, sort, pagination, segment).'

  static examples = [
    '<%= config.bin %> agent list customers --project-dir ./my-project --page-size 5',
    '<%= config.bin %> agent list orders --filter \'{"field":"quantity","operator":"GreaterThan","value":2}\'',
    '<%= config.bin %> agent list customers --segment VIP',
  ]

  static flags = {
    ...agentFlags,
    ...queryFlags,
    connection: Flags.string({description: 'Connection name for --query (live SQL segment)'}),
    query: Flags.string({description: 'Live SQL segment query (requires --connection)'}),
    segment: Flags.string({description: 'List through an existing segment (by name)'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AgentList)

    await withAgent(this, flags, async agent => {
      const collection = agent.collection(args.collection)
      const options = buildSelectOptions(flags)

      let records: unknown[]
      if (flags.query) {
        if (!flags.connection) throw new AgentError('--query requires --connection (the SQL connection name).')
        records = await collection.liveQuerySegment({connectionName: flags.connection, query: flags.query}).list(options)
      } else if (flags.segment) {
        records = await collection.segment(flags.segment).list(options)
      } else {
        records = await collection.list(options)
      }

      printJson(this, records)
    })
  }
}
