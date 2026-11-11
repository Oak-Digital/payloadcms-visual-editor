import { watch } from 'node:fs'
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

import { transformFile } from '@swc/core'
import { hasCurrentBuild } from './build-state.mjs'

const require = createRequire(import.meta.url)
const assets = new Set([
  '.html',
  '.css',
  '.scss',
  '.ttf',
  '.woff',
  '.woff2',
  '.eot',
  '.svg',
  '.jpg',
  '.png',
  '.json',
  '.txt',
])
const ignored = (file) => /(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(file) || file.endsWith('.d.ts')
let timer
let running = false
let stopping = false
const pending = new Set()
const children = new Set()
function start(command, args) {
  const child = spawn(command, args, { stdio: 'inherit', detached: process.platform !== 'win32' })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return child
}
async function update(file) {
  if (ignored(file)) return
  const source = join('src', file)
  const destination = join('dist', file)
  try {
    // Directory events can represent a populated directory being moved into src.
    const entries = await readdir(source, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOTDIR') return null
      throw error
    })
    if (entries) {
      for (const entry of entries) await update(join(file, entry.name))
      return
    }
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      const output = destination.replace(/\.[cm]?[jt]sx?$/, '.js')
      const result = await transformFile(source, {
        configFile: '.swcrc',
        sourceFileName: relative(dirname(output), source),
        outputPath: output,
      })
      await mkdir(dirname(output), { recursive: true })
      if (result.map) await writeFile(`${output}.map`, result.map)
      await writeFile(
        output,
        result.code + (result.map ? `\n//# sourceMappingURL=${output.split('/').pop()}.map\n` : ''),
      )
    } else if (assets.has(extname(file))) {
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(source, destination)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const outputs = /\.[cm]?[jt]sx?$/.test(file)
      ? [
          destination.replace(/\.[cm]?[jt]sx?$/, '.js'),
          destination.replace(/\.[cm]?[jt]sx?$/, '.js.map'),
          destination.replace(/\.[cm]?[jt]sx?$/, '.d.ts'),
        ]
      : [destination]
    for (const output of outputs) await rm(output, { force: true, recursive: true })
  }
}
async function flush() {
  if (running || stopping) return
  running = true
  while (pending.size) {
    const files = [...pending]
    pending.clear()
    for (const file of files) {
      try {
        await update(file)
      } catch (error) {
        console.error(`Visual editor update failed (${file}):`, error)
      }
    }
    console.log(`[visual-editor] Updated ${files.length} source path(s).`)
  }
  running = false
}
const watcher = watch('src', { recursive: true }, (_event, filename) => {
  if (!filename || ignored(filename)) return
  pending.add(filename)
  clearTimeout(timer)
  timer = setTimeout(flush, 150)
})
function stop() {
  stopping = true
  watcher.close()
  clearTimeout(timer)
  for (const child of children) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM')
      else process.kill(-child.pid, 'SIGTERM')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
running = true
if (!(await hasCurrentBuild())) {
  await new Promise((resolve, reject) => {
    const child = start('pnpm', ['build'])
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Initial build failed (${code})`)),
    )
  }).catch((error) => {
    console.error(error)
    stop()
    process.exitCode = 1
  })
}
if (!stopping) {
  // Type declarations and diagnostics must not block runtime code or style updates.
  const types = start(process.execPath, [
    require.resolve('typescript/bin/tsc'),
    '--watch',
    '--outDir',
    'dist',
    '--rootDir',
    './src',
    '--preserveWatchOutput',
  ])
  types.on('error', (error) => {
    console.error(error)
    stop()
    process.exitCode = 1
  })
  types.on('exit', (code) => {
    if (!stopping) {
      console.error(`Visual editor declaration watcher exited (${code}).`)
      stop()
      process.exitCode = code || 1
    }
  })
  running = false
  await flush()
  console.log('[visual-editor] Ready.')
}
