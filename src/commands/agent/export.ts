import {Args, Command, Flags} from '@oclif/core'

import {agentFlags, buildSelectOptions, queryFlags, withAgent} from '../../services/agent/command.js'
import {exportCsvToFile} from '../../services/agent/csv.js'

export default class AgentExport extends Command {
  static args = {
    collection: Args.string({description: 'Collection to export', required: true}),
  }

  static description = 'Export a collection (or a segment) to a CSV file.'

  static examples = ['<%= config.bin %> agent export orders --output orders.csv --project-dir ./my-project']

  static flags = {
    ...agentFlags,
    ...queryFlags,
    output: Flags.string({char: 'o', description: 'Output CSV file', required: true}),
    segment: Flags.string({description: 'Export through an existing segment (by name)'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AgentExport)

    await withAgent(this, flags, async agent => {
      await exportCsvToFile({
        agent,
        collection: args.collection,
        fields: flags.fields ? flags.fields.split(',').map(field => field.trim()).filter(Boolean) : undefined,
        options: buildSelectOptions(flags, {paginate: false}),
        output: flags.output,
        segment: flags.segment,
      })

      this.log(`✓ CSV export written to ${flags.output}.`)
    })
  }
}
