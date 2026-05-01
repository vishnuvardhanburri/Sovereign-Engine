#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const baseUrlArg = args.find((arg) => arg.startsWith('--base-url='))
const baseUrl = (baseUrlArg?.slice('--base-url='.length) || process.env.DEMO_BASE_URL || 'http://127.0.0.1:3400').replace(/\/$/, '')
const headed = args.includes('--headed')
const installBrowsers = args.includes('--install-browsers')
const outDir = path.join(root, 'output', 'playwright', 'demo-qa')
const specPath = path.join(outDir, 'demo-qa.spec.mjs')
const configPath = path.join(outDir, 'playwright.config.mjs')

fs.mkdirSync(outDir, { recursive: true })

fs.writeFileSync(
  specPath,
  `
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const baseURL = process.env.DEMO_BASE_URL || '${baseUrl}'
const outDir = process.env.DEMO_QA_OUT_DIR || '${outDir.replace(/\\/g, '\\\\')}'
const pages = ['/dashboard', '/proof', '/reputation', '/setup', '/activity', '/raas', '/demo-import', '/handoff']

test('Sovereign Engine recording flow loads cleanly', async ({ page }) => {
  const findings = []
  const badResponses = []
  page.on('console', (message) => {
    if (message.type() === 'error') findings.push({ type: 'console', text: message.text() })
  })
  page.on('pageerror', (error) => {
    findings.push({ type: 'pageerror', text: error.message })
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      badResponses.push({ type: 'response', status: response.status(), url: response.url() })
    }
  })

  await page.goto(baseURL + '/login', { waitUntil: 'networkidle' })
  await page.fill('#email', 'demo@sovereign.local')
  await page.fill('#password', 'Demo1234!')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\\/dashboard/, { timeout: 15000 })
  await page.evaluate(() => {
    window.localStorage.setItem('sovereign-engine-recording-mode', 'true')
    document.documentElement.dataset.recordingMode = 'true'
  })

  for (const route of pages) {
    await page.goto(baseURL + route, { waitUntil: 'networkidle' })
    await expect(page.locator('body')).toContainText('Sovereign Engine', { timeout: 15000 })
    await page.screenshot({ path: path.join(outDir, route.replace(/\\//g, '_').replace(/^_/, '') + '.png'), fullPage: true })
  }

  const seriousResponses = badResponses.filter((item) => {
    const pathname = new URL(item.url).pathname
    if (item.status >= 500) return true
    if (pathname === '/_vercel/insights/script.js') return false
    return !/\\/(favicon\\.ico|apple-icon\\.png|icon(-dark|-light)?-?\\d*x?\\d*\\.png|icon\\.svg)$/.test(pathname)
  })
  const seriousFindings = findings.filter((item) => {
    if (item.type === 'console' && /Failed to load resource: the server responded with a status of 404/i.test(item.text)) {
      return seriousResponses.length > 0
    }
    return true
  })

  fs.writeFileSync(path.join(outDir, 'browser-findings.json'), JSON.stringify({ findings, badResponses, seriousFindings, seriousResponses }, null, 2))
  expect(seriousResponses).toEqual([])
  expect(seriousFindings).toEqual([])
})
`
)

fs.writeFileSync(
  configPath,
  `
export default {
  timeout: 60000,
  use: {
    headless: ${headed ? 'false' : 'true'},
    viewport: { width: 1440, height: 1100 },
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['line'], ['html', { outputFolder: '${path.join(outDir, 'html-report').replace(/\\/g, '\\\\')}', open: 'never' }]],
}
`
)

function run(commandArgs) {
  return spawnSync('pnpm', commandArgs, {
    cwd: root,
    env: {
      ...process.env,
      DEMO_BASE_URL: baseUrl,
      DEMO_QA_OUT_DIR: outDir,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function print(result) {
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

if (installBrowsers) {
  console.log('Installing Playwright Chromium browser...')
  const install = run(['exec', 'playwright', 'install', 'chromium'])
  print(install)
  if (install.status !== 0) process.exit(install.status ?? 1)
}

console.log(`Running browser QA against ${baseUrl}`)
let result = run(['exec', 'playwright', 'test', specPath, '--config', configPath])
print(result)

const missingBrowser =
  result.status !== 0 &&
  /Executable doesn't exist|Please run the following command to download new browsers|playwright install/i.test(`${result.stdout}\n${result.stderr}`)

if (missingBrowser && !installBrowsers) {
  console.log('Playwright browser is missing. Installing Chromium once, then retrying...')
  const install = run(['exec', 'playwright', 'install', 'chromium'])
  print(install)
  if (install.status === 0) {
    result = run(['exec', 'playwright', 'test', specPath, '--config', configPath])
    print(result)
  } else {
    result = install
  }
}

if (result.status === 0) {
  console.log(`Browser QA passed. Screenshots: ${path.relative(root, outDir)}`)
} else {
  console.error(`Browser QA failed. Artifacts: ${path.relative(root, outDir)}`)
}

process.exitCode = result.status ?? 1
