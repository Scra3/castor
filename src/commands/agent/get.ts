import {Args, Command, Flags} from '@oclif/core'

import {agentFlags, printJson, withAgent} from '../../services/agent/command.js'

export default class AgentGet extends Command {
  static args = {
    collection: Args.string({description: 'Collection', required: true}),
    id: Args.string({description: 'Record id', required: true}),
  }

  static description = 'Fetch a single record by its id.'

  static examples = ['<%= config.bin %> agent get customers 1 --project-dir ./my-project']

  static flags = {
    ...agentFlags,
    fields: Flags.string({description: 'Fields to return (comma-separated)'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AgentGet)

    await withAgent(this, flags, async agent => {
      const options = flags.fields ? {fields: flags.fields.split(',').map(field => field.trim()).filter(Boolean)} : undefined
      const record = await agent.collection(args.collection).getOne(args.id, options)
      printJson(this, record)
    })
  }
}
