import {Args, Command, Flags} from '@oclif/core'

import {agentFlags, parseDataFlag, printJson, withAgent} from '../../services/agent/command.js'

export default class AgentCreate extends Command {
  static args = {
    collection: Args.string({description: 'Target collection', required: true}),
  }

  static description = 'Create a record in a collection.'

  static examples = [
    '<%= config.bin %> agent create customers --data \'{"email":"demo@forest.test"}\' --project-dir ./my-project',
  ]

  static flags = {
    ...agentFlags,
    data: Flags.string({description: 'Record attributes as JSON', required: true}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AgentCreate)
    const attributes = parseDataFlag(flags.data)

    await withAgent(this, flags, async agent => {
      const record = await agent.collection(args.collection).create(attributes)
      this.log('✓ Record created.')
      printJson(this, record)
    })
  }
}
