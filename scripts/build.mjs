import { spawn } from 'node:child_process'
import { recordBuild, sourceDigest } from './build-state.mjs'

// Capture inputs before building so edits made during a build cannot mark stale output current.
const source = await sourceDigest()
const child = spawn('pnpm', ['build:full'], { stdio: 'inherit' })
child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on('exit', async (code) => {
  if (code !== 0) {
    process.exitCode = code || 1
    return
  }
  try {
    await recordBuild(source)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
})
