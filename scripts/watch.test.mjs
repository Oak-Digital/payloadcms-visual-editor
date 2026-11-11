import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, symlink, writeFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import test from 'node:test'

async function until(check) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch {}
    await setTimeout(50)
  }
  assert.fail('Timed out waiting for watcher output')
}

test(
  'watcher bootstraps, reuses builds, updates files and recovers from errors',
  { timeout: 90000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'visual-editor-watch-'))
    let child
    let log = ''
    const launch = () => {
      log = ''
      child = spawn(process.execPath, ['scripts/watch.mjs'], {
        cwd: directory,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.stdout.on('data', (chunk) => {
        log += chunk
      })
      child.stderr.on('data', (chunk) => {
        log += chunk
      })
    }
    const stop = async () => {
      if (!child) return
      const exited = new Promise((resolve) => child.once('exit', resolve))
      child.kill('SIGTERM')
      await exited
      child = undefined
    }
    const read = (file) => readFile(join(directory, file), 'utf8')
    const write = (file, content) => writeFile(join(directory, file), content)
    try {
      await cp('scripts', join(directory, 'scripts'), { recursive: true })
      await cp('.swcrc', join(directory, '.swcrc'))
      await cp('package.json', join(directory, 'package.json'))
      await symlink(resolve('node_modules'), join(directory, 'node_modules'))
      await mkdir(join(directory, 'src'))
      await write(
        'tsconfig.json',
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            skipLibCheck: true,
            emitDeclarationOnly: true,
            declaration: true,
          },
          include: ['src/**/*.ts'],
        }),
      )
      await write('src/example.ts', 'export const value: number = 1\n')
      await write('src/style.scss', '.example { color: red; }\n')
      launch()
      await until(() => log.includes('[visual-editor] Ready.'))
      assert.match(log, /build:full/)
      await until(async () => (await read('dist/example.d.ts')).includes('value'))
      await stop()
      launch()
      await until(() => log.includes('[visual-editor] Ready.'))
      assert.doesNotMatch(log, /build:full/)
      await write('src/style.scss', '.example { color: blue; }\n')
      await until(async () => (await read('dist/style.scss')).includes('blue'))
      await write('src/example.ts', 'export const value: number = 2\n')
      await until(async () => (await read('dist/example.js')).includes('= 2'))
      await write('src/new.ts', 'export const added = true\n')
      await until(async () => (await read('dist/new.js')).includes('added'))
      await rm(join(directory, 'src/new.ts'))
      await until(async () => {
        try {
          await stat(join(directory, 'dist/new.js'))
          return false
        } catch {
          return true
        }
      })
      const unchanged = (await stat(join(directory, 'dist/example.js'))).mtimeMs
      await write('src/example.test.ts', 'export const testOnly = true\n')
      await setTimeout(400)
      assert.equal((await stat(join(directory, 'dist/example.js'))).mtimeMs, unchanged)
      await write('src/example.ts', 'export const value = ;\n')
      await until(() => log.includes('update failed'))
      await write('src/example.ts', 'export const value = 3\n')
      await until(async () => (await read('dist/example.js')).includes('= 3'))
      assert.doesNotMatch(log, /build:full/)
      await stop()
      launch()
      await until(() => log.includes('[visual-editor] Ready.'))
      assert.match(log, /build:full/, 'stale outputs must cause an initial build')
      await stop()
      await rm(join(directory, 'dist/example.js'))
      launch()
      await until(() => log.includes('[visual-editor] Ready.'))
      assert.match(log, /build:full/, 'missing output must cause an initial build')
    } finally {
      await stop()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
