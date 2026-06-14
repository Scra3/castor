import {Command, Flags} from '@oclif/core'
import {access, writeFile} from 'node:fs/promises'

import {ensureLoggedIn} from '../../services/auth.js'
import {applyInsecure, commonFlags, makeClient} from '../../services/cli-helpers.js'
import {fetchDomains, parseDomainsFlag} from '../../services/layout/fetch.js'
import {ScopeError, resolveScope} from '../../services/layout/scope.js'
import {serializeLayoutFile} from '../../services/layout/yaml-file.js'
import {realConfirm, realPrompts, realSelect} from '../../services/prompts.js'

export default class LayoutPull extends Command {
  static description = 'Export the layout (collections, folders, workflows) into an editable YAML file.'

  static flags = {
    ...commonFlags,
    domains: Flags.string({default: 'layout,folders,workflows', description: 'Domains to export (layout,folders,workflows)'}),
    env: Flags.string({description: 'Environment (name or id)'}),
    file: Flags.string({char: 'f', default: 'forest-layout.yml', description: 'Output file'}),
    force: Flags.boolean({default: false, description: 'Overwrite the existing file without confirmation'}),
    project: Flags.string({description: 'Forest project (name or id)'}),
    team: Flags.string({description: 'Team (name or id)'}),
    yes: Flags.boolean({char: 'y', default: false, description: 'Non-interactive mode'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LayoutPull)
    const interactive = !flags.yes && Boolean(process.stdout.isTTY)

    applyInsecure(flags.insecure, m => this.warn(m))
    const {client, serverUrl} = makeClient(flags, m => this.log(m))

    try {
      await ensureLoggedIn({client, interactive, log: m => this.log(m), oauth: flags.oauth, prompts: realPrompts, serverUrl})

      const domains = parseDomainsFlag(flags.domains)
      const scope = await resolveScope({
        client,
        flags: {env: flags.env, project: flags.project, team: flags.team},
        interactive,
        prompts: {select: realSelect},
        serverUrl,
      })
      this.log(`Scope: ${scope.projectName} / ${scope.environmentName} / ${scope.teamName}`)

      if (!flags.force && (await fileExists(flags.file))) {
        const overwrite = interactive && (await realConfirm(`${flags.file} already exists. Overwrite it?`))
        if (!overwrite) this.error(`${flags.file} already exists. Use --force to overwrite it.`)
      }

      const docs = await fetchDomains(client, scope, domains)
      await writeFile(flags.file, serializeLayoutFile(scope, docs, () => new Date()), 'utf8')

      const layout = docs.layout as {collections?: unknown[]; dashboards?: unknown[]} | undefined
      const counts = [
        layout?.collections ? `${layout.collections.length} collections` : null,
        layout?.dashboards?.length ? `${layout.dashboards.length} dashboards` : null,
        docs.folders ? `${docs.folders.length} folders` : null,
        docs.workflows ? `${docs.workflows.length} workflows` : null,
      ].filter(Boolean)

      this.log(`✓ Layout pulled → ${flags.file} (${counts.join(', ')})`)
      this.log('Edit the file then run `castor layout diff` to see the plan.')
    } catch (error) {
      if (error instanceof ScopeError || error instanceof TypeError) this.error(error.message)
      throw error
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)

    return true
  } catch {
    return false
  }
}
