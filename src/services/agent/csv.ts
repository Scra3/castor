/**
 * CSV export for `agent export`.
 *
 * The agent's `/<collection>.csv` route resets non-curl HTTP clients (superagent
 * buffered, raw node:http and the native fetch all fail against it), and
 * agent-client's streaming `exportCsv` never settles in this runtime. So instead
 * of hitting that route we build the CSV ourselves from the records returned by
 * the regular (working) list path, paginating until the collection is drained.
 */
import type {SelectOptions} from '@forestadmin/agent-client'

import {writeFile} from 'node:fs/promises'

import type {RemoteAgent} from './client.js'

const PAGE_SIZE = 1000

type Row = Record<string, unknown>

/** Render one CSV cell: objects/arrays as JSON, with RFC-4180 quoting. */
export function csvCell(value?: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)

  return /[\n",]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Column set: explicit `fields`, else the union of keys across all rows. */
export function csvColumns(rows: Row[], fields?: string[]): string[] {
  if (fields?.length) return fields

  const columns = new Set<string>()
  for (const row of rows) for (const key of Object.keys(row)) columns.add(key)

  return [...columns]
}

/** Serialize rows to a CSV document (header + rows). */
export function toCsv(rows: Row[], fields?: string[]): string {
  const columns = csvColumns(rows, fields)
  const lines = [columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))]

  return `${lines.join('\n')}\n`
}

/** Drain a collection (or segment) via the list path and write a CSV file. */
export async function exportCsvToFile(params: {
  agent: RemoteAgent
  collection: string
  fields?: string[]
  options: SelectOptions
  output: string
  segment?: string
}): Promise<void> {
  const {agent, collection, fields, options, output, segment} = params
  const source = segment ? agent.collection(collection).segment(segment) : agent.collection(collection)

  const rows: Row[] = []
  for (let page = 1; ; page++) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await source.list<Row>({...options, pagination: {number: page, size: PAGE_SIZE}})
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }

  await writeFile(output, toCsv(rows, fields), 'utf8')
}
