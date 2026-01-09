/**
 * Tab Shepherd - Demo Setup Script
 *
 * This script launches Chrome with the extension loaded and sets up a demo
 * configuration. You can then manually take screenshots for the Chrome Web Store.
 *
 * Usage: node scripts/setup-demo.js
 */

const { chromium } = require('playwright');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '..');

const SAMPLE_CONFIG = {
  enabled: true,
  groups: [
    { name: 'Development', patterns: ['github.com', 'localhost', 'stackoverflow.com'], priority: 1, mode: 'simple' },
    { name: 'Work', patterns: ['docs.google.com', 'drive.google.com', 'slack.com'], priority: 2, mode: 'simple' },
    { name: 'Personal', patterns: ['youtube.com', 'reddit.com', 'twitter.com'], priority: 3, mode: 'simple' }
  ]
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🐑 Tab Shepherd Demo Setup\n');
  console.log('Launching Chrome with extension...\n');

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    channel: 'chrome',
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--window-size=1400,900',
      '--window-position=100,100'
    ]
  });

  // Get extension ID
  let extensionId = null;
  const backgrounds = context.serviceWorkers();
  if (backgrounds.length > 0) {
    extensionId = backgrounds[0].url().split('/')[2];
  } else {
    console.log('Waiting for extension service worker...');
    const sw = await context.waitForEvent('serviceworker');
    extensionId = sw.url().split('/')[2];
  }
  console.log(`Extension ID: ${extensionId}\n`);

  // Open options page and configure
  console.log('Setting up demo configuration...');
  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
  await sleep(1000);

  // Set configuration
  await optionsPage.evaluate(async (config) => {
    await chrome.storage.sync.set({ config });
    await chrome.storage.local.set({ windowBindings: {} });
  }, SAMPLE_CONFIG);
  await optionsPage.reload();
  await sleep(500);

  console.log('✅ Configuration loaded: Development, Work, Personal groups\n');

  // Open demo tabs for Development
  console.log('Opening demo tabs...\n');

  const githubPage = await context.newPage();
  await githubPage.goto('https://github.com/baytelman/tab-shepherd');

  const stackPage = await context.newPage();
  await stackPage.goto('https://stackoverflow.com/questions');

  // Open demo tabs for Work
  const docsPage = await context.newPage();
  await docsPage.goto('https://docs.google.com');

  // Open demo tabs for Personal
  const ytPage = await context.newPage();
  await ytPage.goto('https://www.youtube.com');

  await sleep(2000);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  🎬 DEMO READY! Follow these steps to take screenshots:');
  console.log('');
  console.log('  1. POPUP SCREENSHOT (most important):');
  console.log('     - Click the Tab Shepherd icon (🐑) in the toolbar');
  console.log('     - Assign this window to "Development"');
  console.log('     - Use Cmd+Shift+4 (Mac) to screenshot the popup');
  console.log('');
  console.log('  2. OPTIONS PAGE SCREENSHOT:');
  console.log('     - The Options page is already open');
  console.log('     - Use Cmd+Shift+4 to capture it');
  console.log('');
  console.log('  3. LABELED WINDOWS SCREENSHOT:');
  console.log('     - Assign this window to "Development"');
  console.log('     - Click "Label" button to create tab group');
  console.log('     - Screenshot the tab bar showing the colored label');
  console.log('');
  console.log('  4. MULTI-WINDOW DEMO:');
  console.log('     - Click "Sort All" to organize tabs into windows');
  console.log('     - Each matching tab moves to its assigned window');
  console.log('');
  console.log('  Recommended screenshot sizes for Chrome Web Store:');
  console.log('     - 1280x800 or 640x400 pixels');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Press Ctrl+C when done to close the browser.\n');

  // Keep alive
  await new Promise(() => {});
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
