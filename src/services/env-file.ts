/** Minimal `.env` reader shared by the agent and executor topics. */
import {readFile} from 'node:fs/promises'

/** Parse `KEY=VALUE` lines, stripping surrounding quotes. Ignores blanks/comments. */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const match = /^\s*([\dA-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match) out[match[1]] = match[2].replaceAll(/^["']|["']$/g, '')
  }

  return out
}

/** Read and parse a `.env` file (throws if unreadable). */
export async function readEnvFile(path: string): Promise<Record<string, string>> {
  return parseEnvFile(await readFile(path, 'utf8'))
}
