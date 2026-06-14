import {Command, Flags} from '@oclif/core'

import {
  commonFilterFlags,
  commonFilters,
  printResult,
  publicApiFlags,
  withPublicApi,
} from '../../services/public-api/command.js'

export default class PublicApiAdminLogs extends Command {
  static description = 'List admin logs (project-level admin actions) via the Forest public API.'

  static examples = [
    '<%= config.bin %> public-api admin-logs --project "My Project" --limit 20',
    '<%= config.bin %> public-api admin-logs --resource Team --type update',
    '<%= config.bin %> public-api admin-logs --created-after 2026-06-01',
  ]

  static flags = {
    ...publicApiFlags,
    ...commonFilterFlags,
    initiator: Flags.string({description: 'Filter by initiator (e.g. administrator, system)'}),
    resource: Flags.string({description: 'Filter by resource (e.g. User, Team, Role, Environment)'}),
    type: Flags.string({description: 'Filter by admin action type (e.g. add, update, delete)'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(PublicApiAdminLogs)
    await withPublicApi(this, flags, async ({client, scope}) => {
      const path = `/v1/project/${encodeURIComponent(scope.projectName)}/admin-logs`

      printResult(
        this,
        await client.get(path, {
          ...commonFilters(flags),
          initiator: flags.initiator,
          resource: flags.resource,
          type: flags.type,
        }),
      )
    })
  }
}
