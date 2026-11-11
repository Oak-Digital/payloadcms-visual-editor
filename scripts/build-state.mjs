import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const statePath = 'dist/.watch-build.json'
async function digest(path) {
  const hash = createHash('sha256')
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = join(directory, entry.name)
      if (file === statePath) continue
      if (entry.isDirectory()) await visit(file)
      else hash.update(file).update(await readFile(file))
    }
  }
  await visit(path)
  return hash.digest('hex')
}
export async function sourceDigest() {
  const hash = createHash('sha256')
    .update(await digest('src'))
    .update(await digest('scripts'))
  for (const file of ['package.json', 'tsconfig.json', '.swcrc']) hash.update(await readFile(file))
  return hash.digest('hex')
}
export async function recordBuild(source) {
  await writeFile(statePath, JSON.stringify({ source, output: await digest('dist') }))
}
export async function hasCurrentBuild() {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    return state.source === (await sourceDigest()) && state.output === (await digest('dist'))
  } catch {
    return false
  }
}
