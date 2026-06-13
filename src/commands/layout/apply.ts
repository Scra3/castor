import {Command, Flags} from '@oclif/core'

import type {LayoutDomain, PlannedOp} from '../../services/layout/types.js'

import {ForestApiError} from '../../services/api-client.js'
import {ensureLoggedIn} from '../../services/auth.js'
import {applyInsecure, commonFlags, makeClient} from '../../services/cli-helpers.js'
import {explainApiError, formatPlan} from '../../services/layout/plan-format.js'
import {ScopeError} from '../../services/layout/scope.js'
import {LayoutFileError} from '../../services/layout/yaml-file.js'
import {realConfirm, realPrompts} from '../../services/prompts.js'
import {computePlan} from './diff.js'

const DOMAIN_ORDER: LayoutDomain[] = ['layout', 'folders', 'workflows']

export default class LayoutApply extends Command {
  static description = 'Apply the layout file: compute the plan then send the patches (atomic per domain).'

  static flags = {
    ...commonFlags,
    domains: Flags.string({default: 'layout,folders,workflows', description: 'Domains to apply'}),
    'dry-run': Flags.boolean({default: false, description: 'Show the plan without sending anything'}),
    env: Flags.string({description: 'Environment (name or id)'}),
    file: Flags.string({char: 'f', default: 'forest-layout.yml', description: 'Layout file'}),
    project: Flags.string({description: 'Forest project (name or id)'}),
    team: Flags.string({description: 'Team (name or id)'}),
    yes: Flags.boolean({char: 'y', default: false, description: 'Apply without confirmation'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LayoutApply)
    const interactive = !flags.yes && Boolean(process.stdout.isTTY)

    applyInsecure(flags.insecure, m => this.warn(m))
    const {client, serverUrl} = makeClient(flags, m => this.log(m))

    try {
      await ensureLoggedIn({client, interactive, log: m => this.log(m), oauth: flags.oauth, prompts: realPrompts, serverUrl})

      const {ops, scope, warnings} = await computePlan({
        client,
        domainsFlag: flags.domains,
        file: flags.file,
        flags: {env: flags.env, project: flags.project, team: flags.team},
        interactive,
        serverUrl,
      })

      this.log(`Scope: ${scope.projectName} / ${scope.environmentName} / ${scope.teamName}`)
      this.log('')
      this.log(formatPlan(ops, warnings))

      if (ops.length === 0 || flags['dry-run']) return

      if (interactive && !(await realConfirm(`Apply these ${ops.length} operation(s) on ${scope.environmentName} / ${scope.teamName}?`))) {
        this.log('Cancelled.')

        return
      }

      const applied: string[] = []
      for (const domain of DOMAIN_ORDER) {
        const domainOps = ops.filter(op => op.domain === domain)
        if (domainOps.length === 0) continue

        try {
          // eslint-disable-next-line no-await-in-loop
          await client.patchLayoutDomain(domain, domainOps, {
            environmentId: scope.environmentId,
            teamId: scope.teamId,
          })
          applied.push(`✓ ${domain}: ${domainOps.length} operation${domainOps.length > 1 ? 's' : ''} applied.`)
          this.log(applied.at(-1) as string)
        } catch (error) {
          this.reportFailure(error, domain, domainOps, applied)
        }
      }

      this.log('Reload the Forest Admin interface to see the changes.')
    } catch (error) {
      if (error instanceof ScopeError || error instanceof LayoutFileError || error instanceof TypeError) {
        this.error(error.message)
      }

      throw error
    }
  }

  /** Stop at the first failing domain, reporting what was and wasn't applied. */
  private reportFailure(error: unknown, domain: LayoutDomain, sentOps: PlannedOp[], applied: string[]): never {
    if (error instanceof ForestApiError) {
      const status = applied.length > 0 ? `\nAlready applied before the error:\n${applied.join('\n')}` : ''
      this.error(`${explainApiError(error, sentOps)}\nThe domain "${domain}" was NOT applied (atomic patch).${status}`)
    }

    throw error
  }
}
