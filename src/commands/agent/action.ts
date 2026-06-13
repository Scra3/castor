import {Args, Command, Flags} from '@oclif/core'

import {agentFlags, parseDataFlag, printJson, withAgent} from '../../services/agent/command.js'

export default class AgentAction extends Command {
  // Positional order matters (oclif binds by key order); keep collection first.
  /* eslint-disable perfectionist/sort-objects */
  static args = {
    collection: Args.string({description: 'Collection owning the action', required: true}),
    action: Args.string({description: 'Smart action name', required: true}),
  }
  /* eslint-enable perfectionist/sort-objects */

  static description = 'Execute a smart action (or describe its form with --describe).'

  static examples = [
    '<%= config.bin %> agent action customers "Send email" --record-id 1 --data \'{"Subject":"Hi"}\'',
    '<%= config.bin %> agent action customers "Send email" --record-id 1 --describe',
  ]

  static flags = {
    ...agentFlags,
    data: Flags.string({description: 'Action form values as JSON'}),
    describe: Flags.boolean({default: false, description: 'Show the form fields instead of executing'}),
    'record-id': Flags.string({description: 'Target record id'}),
    'record-ids': Flags.string({description: 'Target record ids, comma-separated'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AgentAction)

    const recordIds = flags['record-ids']
      ? flags['record-ids'].split(',').map(id => id.trim()).filter(Boolean)
      : undefined

    await withAgent(this, flags, async agent => {
      const action = await agent
        .collection(args.collection)
        .action(args.action, {recordId: flags['record-id'], recordIds})

      if (flags.describe) {
        printJson(this, action.getFields())

        return
      }

      if (flags.data) await action.setFields(parseDataFlag(flags.data))
      const result = await action.execute()
      this.log('✓ Action executed.')
      printJson(this, result)
    })
  }
}
