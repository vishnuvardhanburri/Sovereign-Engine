#!/usr/bin/env node

/**
 * Install Chrome for Puppeteer
 */

const { execSync } = require('child_process');

console.log('Installing Chrome for Puppeteer...');

try {
  // Try to install Chrome using the browsers CLI
  execSync('npx puppeteer browsers install chrome', {
    stdio: 'inherit',
    cwd: process.cwd()
  });
  console.log('✅ Chrome installed successfully');
} catch (error) {
  console.log('Failed to install Chrome automatically. Please install Chrome manually:');
  console.log('1. Download Chrome from https://www.google.com/chrome/');
  console.log('2. Or install via Homebrew: brew install --cask google-chrome');
  console.log('3. Or set PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true and use system Chrome');
  process.exit(1);
}