import {Args, Command, Flags} from '@oclif/core'

import type {RemoteAgent} from '../../services/agent/client.js'

import {agentFlags, printJson, withAgent} from '../../services/agent/command.js'
import {AgentError} from '../../services/agent/errors.js'

const CHART_TYPES = ['value', 'distribution', 'percentage', 'objective', 'leaderboard', 'time-based'] as const
type ChartType = (typeof CHART_TYPES)[number]

const METHOD: Record<ChartType, 'distributionChart' | 'leaderboardChart' | 'objectiveChart' | 'percentageChart' | 'timeBasedChart' | 'valueChart'> = {
  distribution: 'distributionChart',
  leaderboard: 'leaderboardChart',
  objective: 'objectiveChart',
  percentage: 'percentageChart',
  'time-based': 'timeBasedChart',
  value: 'valueChart',
}

export default class AgentChart extends Command {
  // Positional order matters (oclif binds by key order) and a required arg must
  // precede an optional one; keep name first, collection optional second.
  /* eslint-disable perfectionist/sort-objects */
  static args = {
    name: Args.string({description: 'Chart name (as defined in the layout)', required: true}),
    collection: Args.string({description: 'Collection (for a record-level chart)'}),
  }
  /* eslint-enable perfectionist/sort-objects */

  static description = 'Load a chart: dashboard-level (name only) or record-level (collection + --record-id).'

  static examples = [
    '<%= config.bin %> agent chart "Total Clients" --type value --project-dir ./my-project',
    '<%= config.bin %> agent chart "Orders" customers --type leaderboard --record-id 1',
  ]

  static flags = {
    ...agentFlags,
    'record-id': Flags.string({description: 'Record id (required for a record-level chart)'}),
    type: Flags.string({description: 'Chart type', options: [...CHART_TYPES], required: true}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AgentChart)
    const method = METHOD[flags.type as ChartType]

    await withAgent(this, flags, async (agent: RemoteAgent) => {
      let result: unknown

      if (args.collection) {
        if (!flags['record-id']) throw new AgentError('A record-level chart requires --record-id.')
        result = await agent.collection(args.collection)[method](args.name, {recordId: flags['record-id']})
      } else {
        result = await agent[method](args.name)
      }

      printJson(this, result)
    })
  }
}
