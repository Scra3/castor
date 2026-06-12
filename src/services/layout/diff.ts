/**
 * The diff engine: compares a remote canonical document against the locally
 * edited one and produces ONLY server-whitelisted JSON Patch operations.
 *
 * Identity-based: array items are matched by `id` (falling back to `name`),
 * never by index. Renames are plain `replace .../name` ops because children
 * are always addressed by the REMOTE item's key (stable across edits).
 * Emission order per domain: adds (parents first) → replaces → removes.
 */
import {isDeepStrictEqual} from 'node:util'

import type {KeyedArrayRule, Rule} from './patch-rules.js'
import type {LayoutDomain, PlannedOp} from './types.js'

import {DOMAIN_RULES, matchesWhitelist} from './patch-rules.js'
import {LayoutFileError} from './yaml-file.js'

export type DiffResult = {
  ops: PlannedOp[]
  warnings: string[]
}

type Item = Record<string, unknown>

/** Address segment for an item: prefer the stable id, else a path-safe name. */
function addressOf(item: Item, yamlPath: string): string {
  if (item.id !== undefined && item.id !== null) return String(item.id)

  const {name} = item
  if (typeof name === 'string' && /^[^\s/:]+$/.test(name)) return name

  throw new LayoutFileError(
    `${yamlPath} : élément sans \`id\` exploitable (et le nom contient des caractères interdits dans un chemin). ` +
      'Ne supprime pas les champs `id` générés par `layout pull`.',
  )
}

/** Identity key used to match local and remote items. */
function identityOf(item: Item): string | undefined {
  if (item.id !== undefined && item.id !== null) return `id:${String(item.id)}`
  if (typeof item.name === 'string') return `name:${item.name}`

  return undefined
}

function indexByIdentity(items: Item[], yamlPath: string): Map<string, Item> {
  const index = new Map<string, Item>()
  for (const item of items) {
    const key = identityOf(item)
    if (key === undefined) {
      throw new LayoutFileError(`${yamlPath} : élément sans \`id\` ni \`name\` — impossible de l'identifier.`)
    }

    if (index.has(key)) throw new LayoutFileError(`${yamlPath} : deux éléments portent la même identité (${key}).`)
    index.set(key, item)
  }

  return index
}

function short(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return '∅'
  if (typeof value === 'object') {
    const {name} = (value as Item)
    if (typeof name === 'string') return `{ name: « ${name} », … }`

    return Array.isArray(value) ? `[${value.length} éléments]` : '{…}'
  }

  const text = typeof value === 'string' ? `« ${value} »` : String(value)

  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

type Bucket = {adds: PlannedOp[]; removes: PlannedOp[]; replaces: PlannedOp[]; warnings: string[]}

type Context = {
  bucket: Bucket
  domain: LayoutDomain
  pathPrefix: string
  premiumPack?: string
  yamlPrefix: string
}

function emit(ctx: Context, kind: keyof Omit<Bucket, 'warnings'>, op: PlannedOp): void {
  ctx.bucket[kind].push(op)
}

function diffScalarLike(
  ctx: Context,
  rule: Rule & {premiumPack?: string; prop: string; removable?: boolean},
  remote: Item,
  local: Item,
): void {
  const path = `${ctx.pathPrefix}/${rule.prop}`
  const yamlPath = `${ctx.yamlPrefix}.${rule.prop}`
  const remoteValue = remote[rule.prop]
  const localValue = local[rule.prop]

  if (isDeepStrictEqual(remoteValue, localValue)) return

  const premiumPack = rule.premiumPack ?? ctx.premiumPack

  if (localValue === undefined) {
    if ('removable' in rule && rule.removable && remoteValue !== undefined) {
      emit(ctx, 'removes', {
        domain: ctx.domain,
        label: `${yamlPath} : supprimé`,
        op: 'remove',
        path,
        premiumPack,
        yamlPath,
      })

      return
    }

    if (remoteValue === undefined) return
    ctx.bucket.warnings.push(
      `${yamlPath} : ce champ ne peut pas être supprimé — remets sa valeur (ou utilise \`layout patch\`).`,
    )

    return
  }

  emit(ctx, 'replaces', {
    domain: ctx.domain,
    label: `${yamlPath} : ${short(remoteValue)} → ${short(localValue)}`,
    op: 'replace',
    path,
    premiumPack,
    value: localValue,
    yamlPath,
  })
}

function stripForAdd(item: Item, stripOnAdd: string[] | undefined): Item {
  const cleaned: Item = {}
  for (const [key, value] of Object.entries(item)) {
    if (stripOnAdd?.includes(key)) continue
    if (value === undefined || (key === 'id' && value === null)) continue
    cleaned[key] = value
  }

  return cleaned
}

function diffKeyedArray(ctx: Context, rule: KeyedArrayRule, remoteItems: Item[], localItems: Item[]): void {
  const arrayPath = rule.segment ? `${ctx.pathPrefix}/${rule.segment}` : ctx.pathPrefix
  const yamlPath = rule.prop ? `${ctx.yamlPrefix}.${rule.prop}` : ctx.yamlPrefix
  const premiumPack = rule.premiumPack ?? ctx.premiumPack

  const remoteIndex = indexByIdentity(remoteItems, `${yamlPath} (distant)`)
  // Local items WITHOUT id and whose name matches nothing remote are additions.
  const localIndex = indexByIdentity(localItems, yamlPath)

  const added = [...localIndex.entries()].filter(([key]) => !remoteIndex.has(key))
  const removed = [...remoteIndex.entries()].filter(([key]) => !localIndex.has(key))
  const common = [...localIndex.entries()].filter(([key]) => remoteIndex.has(key))

  if (rule.fallbackReplaceWhole && (added.length > 0 || removed.length > 0)) {
    emit(ctx, 'replaces', {
      domain: ctx.domain,
      label: `${yamlPath} : remplacement du tableau (${localItems.length} éléments)`,
      op: 'replace',
      path: arrayPath,
      premiumPack,
      value: localItems,
      yamlPath,
    })

    return
  }

  for (const [key, item] of added) {
    if (!rule.addable) {
      ctx.bucket.warnings.push(
        `${yamlPath} : impossible d'ajouter « ${key.split(':')[1]} » (éléments définis par le schéma de l'agent).`,
      )
      continue
    }

    emit(ctx, 'adds', {
      domain: ctx.domain,
      label: `${yamlPath} : ajout de ${short(item)}`,
      op: 'add',
      path: `${arrayPath}/-`,
      premiumPack,
      value: stripForAdd(item, rule.stripOnAdd),
      yamlPath,
    })
  }

  for (const [key, item] of removed) {
    if (!rule.removable) {
      ctx.bucket.warnings.push(
        `${yamlPath} : impossible de supprimer « ${key.split(':')[1]} » (éléments définis par le schéma de l'agent).`,
      )
      continue
    }

    emit(ctx, 'removes', {
      domain: ctx.domain,
      label: `${yamlPath} : suppression de ${short(item)}`,
      op: 'remove',
      path: `${arrayPath}/${addressOf(item, yamlPath)}`,
      premiumPack,
      yamlPath,
    })
  }

  for (const [key, localItem] of common) {
    const remoteItem = remoteIndex.get(key) as Item
    const address = addressOf(remoteItem, yamlPath)
    const childCtx: Context = {
      ...ctx,
      pathPrefix: `${arrayPath}/${address}`,
      premiumPack,
      yamlPrefix: `${yamlPath}[${address}]`,
    }
    applyRules(childCtx, rule.children, remoteItem, localItem)
  }
}

function applyRules(ctx: Context, rules: Rule[], remote: Item, local: Item): void {
  for (const rule of rules) {
    switch (rule.kind) {
      case 'keyedArray': {
        const remoteItems = (rule.prop ? remote[rule.prop] : remote) as Item[] | undefined
        const localItems = (rule.prop ? local[rule.prop] : local) as Item[] | undefined
        diffKeyedArray(ctx, rule, remoteItems ?? [], localItems ?? [])
        break
      }

      case 'object': {
        const remoteChild = (remote[rule.prop] ?? {}) as Item
        const localChild = (local[rule.prop] ?? {}) as Item
        applyRules(
          {
            ...ctx,
            pathPrefix: `${ctx.pathPrefix}/${rule.segment}`,
            yamlPrefix: `${ctx.yamlPrefix}.${rule.prop}`,
          },
          rule.children,
          remoteChild,
          localChild,
        )
        break
      }

      case 'opaque':
      case 'scalar': {
        diffScalarLike(ctx, rule, remote, local)
        break
      }
    }
  }
}

/** Diff one domain; returns whitelisted ops (adds → replaces → removes) + warnings. */
export function diffDomain(domain: LayoutDomain, remote: unknown, local: unknown): DiffResult {
  const bucket: Bucket = {adds: [], removes: [], replaces: [], warnings: []}
  const ctx: Context = {bucket, domain, pathPrefix: '', yamlPrefix: domain}

  applyRules(ctx, DOMAIN_RULES[domain].root, (remote ?? {}) as Item, (local ?? {}) as Item)

  const ops = [...bucket.adds, ...bucket.replaces, ...bucket.removes]

  for (const op of ops) {
    if (!matchesWhitelist(domain, op)) {
      throw new Error(
        `Bug interne : op générée hors whitelist (${op.op} ${op.path}). Signale ce cas — rien n'a été envoyé.`,
      )
    }
  }

  return {ops, warnings: bucket.warnings}
}
