import {Command, Flags} from '@oclif/core'

import {
  commonFilterFlags,
  commonFilters,
  printResult,
  publicApiFlags,
  withPublicApi,
} from '../../services/public-api/command.js'

export default class PublicApiActivityLogs extends Command {
  static description = 'List activity logs (record-level audit trail) of the scope via the Forest public API.'

  static examples = [
    '<%= config.bin %> public-api activity-logs --project "My Project" --env Production --limit 20',
    '<%= config.bin %> public-api activity-logs --collection customers --action update',
    '<%= config.bin %> public-api activity-logs --created-after 2026-06-01',
  ]

  static flags = {
    ...publicApiFlags,
    ...commonFilterFlags,
    action: Flags.string({description: 'Filter by action (e.g. update, create, delete)'}),
    'by-team': Flags.string({description: 'Filter by team name'}),
    collection: Flags.string({description: 'Filter by collection name'}),
    record: Flags.string({description: 'Filter by record id'}),
    type: Flags.string({description: 'Filter by log type (e.g. write, delete)'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(PublicApiActivityLogs)
    await withPublicApi(this, flags, async ({client, scope}) => {
      const path = `/v1/project/${encodeURIComponent(scope.projectName)}/environment/${encodeURIComponent(
        scope.environmentName,
      )}/activity-logs`

      printResult(
        this,
        await client.get(path, {
          ...commonFilters(flags),
          action: flags.action,
          collectionName: flags.collection,
          recordId: flags.record,
          teamName: flags['by-team'],
          type: flags.type,
        }),
      )
    })
  }
}
