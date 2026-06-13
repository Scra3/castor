import {Args, Command, Flags} from '@oclif/core'

import {agentFlags, parseDataFlag, printJson, withAgent} from '../../services/agent/command.js'

export default class AgentUpdate extends Command {
  static args = {
    collection: Args.string({description: 'Target collection', required: true}),
    id: Args.string({description: 'Record id', required: true}),
  }

  static description = 'Update a record by its id.'

  static examples = [
    '<%= config.bin %> agent update customers 1 --data \'{"email":"new@forest.test"}\' --project-dir ./my-project',
  ]

  static flags = {
    ...agentFlags,
    data: Flags.string({description: 'Attributes to change as JSON', required: true}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AgentUpdate)
    const attributes = parseDataFlag(flags.data)

    await withAgent(this, flags, async agent => {
      const record = await agent.collection(args.collection).update(args.id, attributes)
      this.log('✓ Record updated.')
      printJson(this, record)
    })
  }
}
