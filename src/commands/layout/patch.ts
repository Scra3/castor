import {Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'

import type {JsonPatchOp} from '../../services/layout/types.js'

import {ForestApiError} from '../../services/api-client.js'
import {ensureLoggedIn} from '../../services/auth.js'
import {applyInsecure, commonFlags, makeClient} from '../../services/cli-helpers.js'
import {ScopeError, resolveScope} from '../../services/layout/scope.js'
import {realConfirm, realPrompts, realSelect} from '../../services/prompts.js'

export default class LayoutPatch extends Command {
  static description = 'Send raw JSON Patch (RFC 6902) operations to the layout — expert escape hatch.'

  static examples = [
    `echo '[{"op":"replace","path":"/collections/customers/icon","value":"users"}]' | castor layout patch --yes`,
  ]

  static flags = {
    ...commonFlags,
    domain: Flags.string({default: 'layout', description: 'Target domain', options: ['layout', 'folders', 'workflows']}),
    env: Flags.string({description: 'Environment (name or id)'}),
    file: Flags.string({char: 'f', description: 'JSON file containing the operations array (otherwise stdin)'}),
    project: Flags.string({description: 'Forest project (name or id)'}),
    team: Flags.string({description: 'Team (name or id)'}),
    yes: Flags.boolean({char: 'y', default: false, description: 'Do not ask for confirmation'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LayoutPatch)
    const interactive = !flags.yes && Boolean(process.stdout.isTTY)

    applyInsecure(flags.insecure, m => this.warn(m))
    const {client, serverUrl} = makeClient(flags, m => this.log(m))

    try {
      const ops = await this.readOps(flags.file)
      if (ops.length === 0) this.error('No operation to send.')

      await ensureLoggedIn({client, interactive, log: m => this.log(m), oauth: flags.oauth, prompts: realPrompts, serverUrl})

      const scope = await resolveScope({
        client,
        flags: {env: flags.env, project: flags.project, team: flags.team},
        interactive,
        prompts: {select: realSelect},
        serverUrl,
      })

      this.log(`Scope: ${scope.projectName} / ${scope.environmentName} / ${scope.teamName}`)
      for (const op of ops) this.log(`  ${op.op} ${op.path}`)

      if (interactive && !(await realConfirm(`Send these ${ops.length} operation(s) on ${flags.domain}?`))) {
        this.log('Cancelled.')

        return
      }

      await client.patchLayoutDomain(flags.domain as 'folders' | 'layout' | 'workflows', ops, {
        environmentId: scope.environmentId,
        teamId: scope.teamId,
      })

      this.log(`✓ ${ops.length} operation(s) applied on ${flags.domain} (${scope.environmentName} / ${scope.teamName}).`)
    } catch (error) {
      if (error instanceof ScopeError) this.error(error.message)
      if (error instanceof ForestApiError) {
        this.error(`The server rejected the patch (${error.status}): ${error.detail}`)
      }

      throw error
    }
  }

  /** Read the ops array from --file or stdin. */
  private async readOps(file?: string): Promise<JsonPatchOp[]> {
    const raw = file ? await readFile(file, 'utf8') : await readStdin()

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.error('Invalid input: provide a JSON array of {op, path, value} operations.')
    }

    if (!Array.isArray(parsed)) this.error('The input must be a JSON ARRAY of RFC 6902 operations.')

    return parsed as JsonPatchOp[]
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}
