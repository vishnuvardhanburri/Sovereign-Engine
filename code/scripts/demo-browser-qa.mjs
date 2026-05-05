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
const pages = ['/dashboard', '/proof', '/reputation', '/setup', '/activity', '/raas', '/demo-import', '/handoff']
const qaTimeoutMs = Number(process.env.DEMO_QA_TIMEOUT_MS || 120_000)

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

function installChromium() {
  console.log('Installing Playwright Chromium browser...')
  const install = spawnSync('pnpm', ['exec', 'playwright', 'install', 'chromium'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5 * 60 * 1000,
  })
  if (install.stdout) process.stdout.write(install.stdout)
  if (install.stderr) process.stderr.write(install.stderr)
  return install.status === 0
}

function screenshotName(route) {
  return `${route.replace(/\//g, '_').replace(/^_/, '') || 'home'}.png`
}

function writeHtmlGallery() {
  const cards = pages
    .map((route) => {
      const file = screenshotName(route)
      return `<article><h2>${route}</h2><img src="../${file}" alt="${route} screenshot" /></article>`
    })
    .join('\n')
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sovereign Engine Browser QA</title>
  <style>
    body { margin: 0; padding: 32px; background: #0c111d; color: #f8fafc; font-family: ui-sans-serif, system-ui, sans-serif; }
    main { display: grid; gap: 24px; }
    article { border: 1px solid rgba(148, 163, 184, .24); border-radius: 18px; padding: 18px; background: rgba(15, 23, 42, .82); }
    h1, h2 { margin: 0 0 14px; }
    img { width: 100%; border-radius: 12px; border: 1px solid rgba(148, 163, 184, .22); background: #fff; }
  </style>
</head>
<body>
  <main>
    <h1>Sovereign Engine Browser QA</h1>
    ${cards}
  </main>
</body>
</html>`
  const reportDir = path.join(outDir, 'html-report')
  fs.mkdirSync(reportDir, { recursive: true })
  fs.writeFileSync(path.join(reportDir, 'index.html'), html)
}

async function runQa() {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch({ headless: !headed })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    ignoreHTTPSErrors: true,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  page.setDefaultNavigationTimeout(30_000)

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

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
    // Use the standards-based login API to avoid flakiness around hydration timing
    // in Next.js dev mode.
    await page.evaluate(async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'demo@sovereign.local', password: 'Demo1234!' }),
      })
      if (!res.ok) throw new Error('login failed')
    })
    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
    await page.evaluate(() => {
      window.localStorage.setItem('sovereign-engine-recording-mode', 'true')
      document.documentElement.dataset.recordingMode = 'true'
    })

    for (const route of pages) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
      const body = await page.locator('body').innerText({ timeout: 15_000 })
      if (!body.includes('Sovereign Engine')) throw new Error(`${route} did not render Sovereign Engine branding.`)
      await page.screenshot({ path: path.join(outDir, screenshotName(route)), fullPage: true })
    }
  } finally {
    await browser.close()
  }

  const seriousResponses = badResponses.filter((item) => {
    const pathname = new URL(item.url).pathname
    if (item.status >= 500) return true
    if (pathname === '/_vercel/insights/script.js') return false
    // Demo-only Next.js dev UX suppression endpoints. These may 404 depending on Next version.
    if (pathname === '/__nextjs_disable_devtools' || pathname === '/__nextjs_disable_dev_overlay') return false
    return !/(favicon\.ico|apple-icon\.png|icon(-dark|-light)?-?\d*x?\d*\.png|icon\.svg)$/.test(pathname)
  })
  const seriousFindings = findings.filter((item) => {
    if (item.type === 'console' && /Failed to load resource: the server responded with a status of 404/i.test(item.text)) {
      return seriousResponses.length > 0
    }
    return true
  })

  fs.writeFileSync(path.join(outDir, 'browser-findings.json'), JSON.stringify({ findings, badResponses, seriousFindings, seriousResponses }, null, 2))
  writeHtmlGallery()

  if (seriousResponses.length || seriousFindings.length) {
    throw new Error(`Browser QA found ${seriousResponses.length} serious HTTP issue(s) and ${seriousFindings.length} serious console issue(s).`)
  }
}

async function main() {
  console.log(`Running browser QA against ${baseUrl}`)
  if (installBrowsers) installChromium()

  try {
    await Promise.race([
      runQa(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Browser QA timed out after ${qaTimeoutMs}ms.`)), qaTimeoutMs)),
    ])
    console.log(`Browser QA passed. Screenshots: ${path.relative(root, outDir)}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/Executable doesn't exist|Please run the following command to download new browsers|playwright install/i.test(message) && !installBrowsers) {
      if (installChromium()) {
        await Promise.race([
          runQa(),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Browser QA timed out after ${qaTimeoutMs}ms.`)), qaTimeoutMs)),
        ])
        console.log(`Browser QA passed. Screenshots: ${path.relative(root, outDir)}`)
        return
      }
    }
    console.error(`Browser QA failed. Artifacts: ${path.relative(root, outDir)}`)
    console.error(message)
    process.exitCode = 1
  }
}

main()
