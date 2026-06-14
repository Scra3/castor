import {Command, Flags} from '@oclif/core'

import {
  commonFilterFlags,
  commonFilters,
  dateRange,
  printResult,
  publicApiFlags,
  withPublicApi,
} from '../../services/public-api/command.js'

export default class PublicApiNotes extends Command {
  static description = 'List notes attached to records of the scope via the Forest public API.'

  static examples = [
    '<%= config.bin %> public-api notes --project "My Project" --env Production --limit 20',
    '<%= config.bin %> public-api notes --collection customers --record 42',
    '<%= config.bin %> public-api notes --updated-after 2026-06-01',
  ]

  static flags = {
    ...publicApiFlags,
    ...commonFilterFlags,
    'archived-after': Flags.string({description: 'Only notes archived on/after this date (ISO)'}),
    'archived-before': Flags.string({description: 'Only notes archived on/before this date (ISO)'}),
    'by-team': Flags.string({description: 'Filter by team name'}),
    collection: Flags.string({description: 'Filter by collection name'}),
    record: Flags.string({description: 'Filter by record id'}),
    'updated-after': Flags.string({description: 'Only notes updated on/after this date (ISO)'}),
    'updated-before': Flags.string({description: 'Only notes updated on/before this date (ISO)'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(PublicApiNotes)
    await withPublicApi(this, flags, async ({client, scope}) => {
      const path = `/v1/project/${encodeURIComponent(scope.projectName)}/environment/${encodeURIComponent(
        scope.environmentName,
      )}/notes`

      printResult(
        this,
        await client.get(path, {
          ...commonFilters(flags),
          ...dateRange('updatedAt', flags['updated-after'], flags['updated-before']),
          ...dateRange('archivedAt', flags['archived-after'], flags['archived-before']),
          collectionName: flags.collection,
          recordId: flags.record,
          teamName: flags['by-team'],
        }),
      )
    })
  }
}
