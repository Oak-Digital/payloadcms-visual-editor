import { watch } from 'node:fs'
import { spawn } from 'node:child_process'

let running = false
let pending = false
let timer
function build() {
  if (running) {
    pending = true
    return
  }
  running = true
  const child = spawn('pnpm', ['build'], { stdio: 'inherit' })
  child.on('exit', (code) => {
    running = false
    if (code) console.error(`Visual editor build failed (${code}); waiting for edits.`)
    if (pending) {
      pending = false
      build()
    }
  })
}
watch(new URL('../src', import.meta.url), { recursive: true }, () => {
  clearTimeout(timer)
  timer = setTimeout(build, 150)
})
build()
