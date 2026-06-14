/**
 * Compile a YAML workflow spec into the BPMN XML the orchestrator's bpmn-parser
 * accepts (verified live). A spec is a step graph; each step maps to a BPMN
 * element carrying Forest config as `forest:*` attributes, chained by
 * sequenceFlows. See docs/WORKFLOWS.md for the type → BPMN mapping.
 *
 * Note: the parser reads structure + prompt + execution flags only — per-field
 * args for read/update and action/mcp wiring are resolved at runtime (AI + prompt
 * + the `trigger` input). The spec sets the shape; runtime supplies the data.
 */
import {parse} from 'yaml'

import {WorkflowError} from './errors.js'

/** Spec step types → BPMN element + `forest:alternative` (task types). */
const STEP_TYPES = {
  action: {alternative: 'trigger-action', element: 'serviceTask'},
  condition: {element: 'exclusiveGateway'},
  end: {element: 'endEvent'},
  escalation: {element: 'intermediateThrowEvent'},
  guidance: {alternative: 'guideline', element: 'userTask'},
  'load-related': {alternative: 'load-related-record', element: 'serviceTask'},
  mcp: {alternative: 'mcp-server', element: 'serviceTask'},
  read: {alternative: 'get-data', element: 'serviceTask'},
  update: {alternative: 'update-data', element: 'serviceTask'},
} as const

export type StepType = keyof typeof STEP_TYPES

export type BranchSpec = {answer: string; color?: string; next: string}

export type StepSpec = {
  auto?: boolean
  autoComplete?: boolean
  branches?: BranchSpec[]
  id: string
  inboxId?: string
  mcpServerId?: string
  next?: string
  prompt?: string
  title?: string
  type: StepType
}

export type WorkflowSpec = {
  collection: string
  name: string
  segments?: string[]
  start?: string
  steps: StepSpec[]
}

const ID_RE = /^[A-Z_a-z][\w-]*$/

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/** The step ids a step can transition to (branch targets for conditions, else `next`). */
function stepTargets(step: StepSpec): string[] {
  if (step.type === 'condition') return (step.branches ?? []).map(b => b.next)

  return step.next ? [step.next] : []
}

/** Parse YAML into a validated WorkflowSpec (throws WorkflowError on any problem). */
export function parseWorkflowSpec(yaml: string): WorkflowSpec {
  let doc: unknown
  try {
    doc = parse(yaml)
  } catch {
    throw new WorkflowError('Invalid YAML in the workflow spec.')
  }

  if (!doc || typeof doc !== 'object') throw new WorkflowError('The workflow spec must be a YAML object.')
  const spec = doc as Partial<WorkflowSpec>

  if (!spec.name || typeof spec.name !== 'string') throw new WorkflowError('`name` is required.')
  if (!spec.collection || typeof spec.collection !== 'string') throw new WorkflowError('`collection` is required.')
  if (!Array.isArray(spec.steps) || spec.steps.length === 0) throw new WorkflowError('`steps` must be a non-empty list.')

  const ids = new Set<string>()
  for (const step of spec.steps) validateStep(step, ids)

  for (const step of spec.steps) {
    for (const target of stepTargets(step)) {
      if (!ids.has(target)) throw new WorkflowError(`Step "${step.id}" points to unknown step "${target}".`)
    }
  }

  const entry = spec.start ?? spec.steps[0].id
  if (!ids.has(entry)) throw new WorkflowError(`\`start\` "${entry}" is not a defined step.`)
  if (!spec.steps.some(s => s.type === 'end')) throw new WorkflowError('The workflow needs at least one `end` step.')

  return {collection: spec.collection, name: spec.name, segments: spec.segments ?? [], start: entry, steps: spec.steps}
}

function validateStep(step: StepSpec, seen: Set<string>): void {
  if (!step.id || !ID_RE.test(step.id)) {
    throw new WorkflowError(`Each step needs an \`id\` matching ${ID_RE} (got "${step.id ?? ''}").`)
  }

  if (seen.has(step.id)) throw new WorkflowError(`Duplicate step id "${step.id}".`)
  seen.add(step.id)

  if (!(step.type in STEP_TYPES)) {
    throw new WorkflowError(`Step "${step.id}": unsupported type "${step.type}". Supported: ${Object.keys(STEP_TYPES).join(', ')}.`)
  }

  if (step.type === 'end') {
    if (step.next || step.branches) throw new WorkflowError(`Step "${step.id}" (end) must not have \`next\`/\`branches\`.`)

    return
  }

  if (step.type === 'condition') {
    if (!Array.isArray(step.branches) || step.branches.length < 2) {
      throw new WorkflowError(`Condition "${step.id}" needs at least 2 \`branches\` (each with answer + next).`)
    }

    for (const branch of step.branches) {
      if (!branch.answer || !branch.next) throw new WorkflowError(`Condition "${step.id}": each branch needs \`answer\` and \`next\`.`)
    }

    return
  }

  if (!step.next) throw new WorkflowError(`Step "${step.id}" needs a \`next\` step.`)
  if (step.type === 'mcp' && !step.mcpServerId) throw new WorkflowError(`Step "${step.id}" (mcp) needs \`mcpServerId\`.`)
  if (step.type === 'escalation' && !step.inboxId) throw new WorkflowError(`Step "${step.id}" (escalation) needs \`inboxId\`.`)
}

function flowId(source: string, target: string): string {
  return `flow_${source}_${target}`
}

/** Build the BPMN element + its outgoing sequenceFlows for one step. */
function renderStep(step: StepSpec): {element: string; flows: string[]} {
  const def = STEP_TYPES[step.type]
  const name = xml(step.title ?? step.id)
  const branches = step.type === 'condition' ? step.branches ?? [] : step.next ? [{answer: '', next: step.next}] : []
  const flows = branches.map(b =>
    `    <bpmn:sequenceFlow id="${flowId(step.id, b.next)}" sourceRef="${step.id}" targetRef="${b.next}"` +
    ('answer' in b && b.answer ? ` name="${xml(b.answer)}"` : '') +
    ('color' in b && (b as BranchSpec).color ? ` forest:buttonColor="${xml((b as BranchSpec).color as string)}"` : '') +
    ' />',
  )

  const attrs: string[] = []
  if ('alternative' in def) attrs.push(`forest:alternative="${def.alternative}"`)
  if (step.auto) attrs.push('forest:automaticExecution="true"')
  if (step.autoComplete) attrs.push('forest:automaticCompletion="true"')
  if (step.prompt) attrs.push(`forest:description="${xml(step.prompt)}"`)
  if (step.type === 'mcp' && step.mcpServerId) attrs.push(`forest:mcpServerId="${xml(step.mcpServerId)}"`)
  if (step.type === 'escalation' && step.inboxId) attrs.push(`forest:inboxId="${xml(step.inboxId)}"`)

  const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : ''
  const outgoing = branches.map(b => `<bpmn:outgoing>${flowId(step.id, b.next)}</bpmn:outgoing>`).join('')
  const tag = def.element

  const element =
    step.type === 'end'
      ? `    <bpmn:endEvent id="${step.id}" name="${name}"></bpmn:endEvent>`
      : `    <bpmn:${tag} id="${step.id}" name="${name}"${attrStr}>${outgoing}</bpmn:${tag}>`

  return {element, flows}
}

/** Compile a validated spec into BPMN XML + the entry step id. */
export function compileWorkflowToBpmn(spec: WorkflowSpec): {bpmn: string; entryId: string} {
  const entryId = spec.start as string
  const elements: string[] = [
    `    <bpmn:startEvent id="Start_1"><bpmn:outgoing>${flowId('Start_1', entryId)}</bpmn:outgoing></bpmn:startEvent>`,
  ]
  const flows: string[] = [`    <bpmn:sequenceFlow id="${flowId('Start_1', entryId)}" sourceRef="Start_1" targetRef="${entryId}" />`]

  for (const step of spec.steps) {
    const rendered = renderStep(step)
    elements.push(rendered.element)
    flows.push(...rendered.flows)
  }

  const bpmn = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:forest="https://forestadmin.com">',
    '  <bpmn:process id="Process_1" isExecutable="true">',
    ...elements,
    ...flows,
    '  </bpmn:process>',
    '</bpmn:definitions>',
    '',
  ].join('\n')

  return {bpmn, entryId}
}
