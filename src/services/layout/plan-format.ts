/** Human rendering of a diff plan, and translation of server errors. */
import type {ForestApiError} from '../api-client.js'
import type {LayoutDomain, PlannedOp} from './types.js'

const OP_PREFIX: Record<string, string> = {add: '+', remove: '-', replace: '~', test: '?'}

/** Render the plan grouped by domain, with warnings and a final count. */
export function formatPlan(ops: PlannedOp[], warnings: string[]): string {
  const lines: string[] = []

  if (ops.length === 0 && warnings.length === 0) {
    return '✓ Aucun changement : le layout distant correspond déjà au fichier.'
  }

  const domains: LayoutDomain[] = ['layout', 'folders', 'workflows']
  for (const domain of domains) {
    const domainOps = ops.filter(op => op.domain === domain)
    if (domainOps.length === 0) continue

    lines.push(`${domain} (${domainOps.length} changement${domainOps.length > 1 ? 's' : ''})`)
    for (const op of domainOps) lines.push(`  ${OP_PREFIX[op.op] ?? '·'} ${op.label}`)
  }

  for (const warning of warnings) lines.push(`  ⚠ ${warning}`)

  if (ops.length > 0) {
    const perDomain = domains
      .map(domain => ({count: ops.filter(op => op.domain === domain).length, domain}))
      .filter(d => d.count > 0)
      .map(d => `${d.count} PATCH /api/${d.domain}`)
    lines.push('', `${ops.length} opération${ops.length > 1 ? 's' : ''} à envoyer (${perDomain.join(', ')}).`)
  }

  return lines.join('\n')
}

/** Map a Forest API error to an actionable message (422 path → YAML key, 403 premium…). */
export function explainApiError(error: ForestApiError, sentOps: PlannedOp[]): string {
  if (error.status === 422) {
    const match = error.detail.match(/path:\s*'([^']+)'/)
    const offending = match ? sentOps.find(op => op.path === match[1]) : undefined

    const origin = offending
      ? `\n  → provient de : ${offending.yamlPath}\n  Annule cette modification dans le fichier, ou utilise \`layout patch\` en connaissance de cause.`
      : ''

    return `Le serveur a refusé le patch (422) :\n  ${error.detail}${origin}`
  }

  if (error.status === 403) {
    const premium = sentOps.find(op => op.premiumPack)
    if (premium) {
      return (
        `Fonctionnalité premium requise (pack « ${premium.premiumPack} ») pour ${premium.yamlPath}.\n` +
        'Rien n’a été appliqué pour ce domaine (patch atomique).'
      )
    }

    return 'Accès refusé (403) : ton rôle ne permet pas de modifier le layout de cet environnement.'
  }

  return `Erreur serveur (${error.status}) : ${error.detail}`
}
