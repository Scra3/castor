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
  static description = 'Appliquer le fichier de layout : calcule le plan puis envoie les patchs (atomiques par domaine).'

  static flags = {
    ...commonFlags,
    domains: Flags.string({default: 'layout,folders,workflows', description: 'Domaines à appliquer'}),
    'dry-run': Flags.boolean({default: false, description: 'Afficher le plan sans rien envoyer'}),
    env: Flags.string({description: 'Environnement (nom ou id)'}),
    file: Flags.string({char: 'f', default: 'forest-layout.yml', description: 'Fichier de layout'}),
    project: Flags.string({description: 'Projet Forest (nom ou id)'}),
    team: Flags.string({description: 'Équipe (nom ou id)'}),
    yes: Flags.boolean({char: 'y', default: false, description: 'Appliquer sans confirmation'}),
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

      this.log(`Scope : ${scope.projectName} / ${scope.environmentName} / ${scope.teamName}`)
      this.log('')
      this.log(formatPlan(ops, warnings))

      if (ops.length === 0 || flags['dry-run']) return

      if (interactive && !(await realConfirm(`Appliquer ces ${ops.length} opération(s) sur ${scope.environmentName} / ${scope.teamName} ?`))) {
        this.log('Annulé.')

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
          applied.push(`✓ ${domain} : ${domainOps.length} opération${domainOps.length > 1 ? 's' : ''} appliquée${domainOps.length > 1 ? 's' : ''}.`)
          this.log(applied.at(-1) as string)
        } catch (error) {
          this.reportFailure(error, domain, domainOps, applied)
        }
      }

      this.log('Recharge l’interface Forest Admin pour voir les changements.')
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
      const status = applied.length > 0 ? `\nDéjà appliqué avant l'erreur :\n${applied.join('\n')}` : ''
      this.error(`${explainApiError(error, sentOps)}\nLe domaine « ${domain} » n'a PAS été appliqué (patch atomique).${status}`)
    }

    throw error
  }
}
