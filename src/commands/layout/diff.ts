import {Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'

import type {LayoutDomain, PlannedOp} from '../../services/layout/types.js'

import {ensureLoggedIn} from '../../services/auth.js'
import {applyInsecure, commonFlags, makeClient} from '../../services/cli-helpers.js'
import {diffDomain} from '../../services/layout/diff.js'
import {fetchDomains, parseDomainsFlag} from '../../services/layout/fetch.js'
import {formatPlan} from '../../services/layout/plan-format.js'
import {ScopeError, resolveScope} from '../../services/layout/scope.js'
import {LayoutFileError, parseLayoutFile} from '../../services/layout/yaml-file.js'
import {realPrompts, realSelect} from '../../services/prompts.js'

/** Shared by `layout diff` and `layout apply`: parse file, resolve scope, compute plan. */
export async function computePlan(options: {
  client: Parameters<typeof fetchDomains>[0]
  domainsFlag: string
  file: string
  flags: {env?: string; project?: string; team?: string}
  interactive: boolean
  serverUrl: string
}): Promise<{ops: PlannedOp[]; scope: Awaited<ReturnType<typeof resolveScope>>; warnings: string[]}> {
  const content = await readFile(options.file, 'utf8')
  const {docs, scope: fileScope} = parseLayoutFile(content)

  const scope = await resolveScope({
    client: options.client,
    flags: options.flags,
    fromFile: fileScope,
    interactive: options.interactive,
    prompts: {select: realSelect},
    serverUrl: options.serverUrl,
  })

  const requested = parseDomainsFlag(options.domainsFlag)
  // Only diff the domains present in the file AND requested.
  const domains = requested.filter(domain => docs[domain] !== undefined)

  const remote = await fetchDomains(options.client, scope, domains)

  const ops: PlannedOp[] = []
  const warnings: string[] = []
  for (const domain of domains) {
    const result = diffDomain(domain as LayoutDomain, remote[domain], docs[domain])
    ops.push(...result.ops)
    warnings.push(...result.warnings)
  }

  return {ops, scope, warnings}
}

export default class LayoutDiff extends Command {
  static description = 'Comparer le fichier de layout local avec l’état distant et afficher le plan de changements.'

  static flags = {
    ...commonFlags,
    domains: Flags.string({default: 'layout,folders,workflows', description: 'Domaines à comparer'}),
    env: Flags.string({description: 'Environnement (nom ou id)'}),
    file: Flags.string({char: 'f', default: 'forest-layout.yml', description: 'Fichier de layout'}),
    json: Flags.boolean({default: false, description: 'Imprimer les opérations JSON Patch (scriptable)'}),
    project: Flags.string({description: 'Projet Forest (nom ou id)'}),
    team: Flags.string({description: 'Équipe (nom ou id)'}),
    yes: Flags.boolean({char: 'y', default: false, description: 'Mode non-interactif'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LayoutDiff)
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

      if (flags.json) {
        const byDomain: Record<string, Array<{op: string; path: string; value?: unknown}>> = {}
        for (const op of ops) {
          byDomain[op.domain] ??= []
          byDomain[op.domain].push({op: op.op, path: op.path, ...(op.value === undefined ? {} : {value: op.value})})
        }

        this.log(JSON.stringify(byDomain, null, 2))

        return
      }

      this.log(`Scope : ${scope.projectName} / ${scope.environmentName} / ${scope.teamName} (depuis ${flags.file})`)
      this.log('')
      this.log(formatPlan(ops, warnings))
    } catch (error) {
      if (error instanceof ScopeError || error instanceof LayoutFileError || error instanceof TypeError) {
        this.error(error.message)
      }

      throw error
    }
  }
}
