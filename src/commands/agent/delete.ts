import {Args, Command} from '@oclif/core'

import {agentFlags, withAgent} from '../../services/agent/command.js'
import {AgentError} from '../../services/agent/errors.js'
import {realConfirm} from '../../services/prompts.js'

export default class AgentDelete extends Command {
  static args = {
    collection: Args.string({description: 'Target collection', required: true}),
    ids: Args.string({description: 'Id(s) to delete, comma-separated', required: true}),
  }

  static description = 'Delete one or more records (confirmation prompt in interactive mode).'

  static examples = [
    '<%= config.bin %> agent delete customers 1 --project-dir ./my-project',
    '<%= config.bin %> agent delete customers 1,2,3 --yes',
  ]

  static flags = {...agentFlags}

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AgentDelete)
    const ids = args.ids.split(',').map(id => id.trim()).filter(Boolean)
    if (ids.length === 0) throw new AgentError('No id provided.')

    const interactive = !flags.yes && Boolean(process.stdout.isTTY)
    if (interactive && !(await realConfirm(`Delete ${ids.length} record(s) from "${args.collection}"?`))) {
      this.log('Cancelled.')

      return
    }

    await withAgent(this, flags, async agent => {
      await agent.collection(args.collection).delete(ids)
      this.log(`✓ ${ids.length} record(s) deleted from "${args.collection}".`)
    })
  }
}
