const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');

// Sample configuration matching the default groups
const SAMPLE_CONFIG = {
  enabled: true,
  groups: [
    { name: 'Development', patterns: ['github.com', 'localhost', 'stackoverflow.com'], priority: 1, mode: 'simple' },
    { name: 'Work', patterns: ['docs.google.com', 'drive.google.com', 'slack.com'], priority: 2, mode: 'simple' },
    { name: 'Personal', patterns: ['youtube.com', 'reddit.com', 'twitter.com'], priority: 3, mode: 'simple' }
  ]
};

// URLs to open for each group demonstration
const DEMO_URLS = {
  'Development': [
    'https://github.com/baytelman/tab-shepherd',
    'https://stackoverflow.com/questions/tagged/javascript'
  ],
  'Work': [
    'https://docs.google.com',
    'https://drive.google.com'
  ],
  'Personal': [
    'https://www.youtube.com',
    'https://www.reddit.com'
  ]
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  // Ensure screenshots directory exists
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  console.log('Launching Chrome with extension...');

  // Launch Chrome with the extension
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    channel: 'chrome',
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--window-size=1280,800'
    ],
    viewport: { width: 1280, height: 800 }
  });

  // Wait for extension to load and get its ID
  let extensionId = null;
  const backgrounds = context.serviceWorkers();
  if (backgrounds.length > 0) {
    extensionId = backgrounds[0].url().split('/')[2];
  } else {
    // Wait for service worker to start
    const sw = await context.waitForEvent('serviceworker');
    extensionId = sw.url().split('/')[2];
  }

  console.log(`Extension ID: ${extensionId}`);
  await sleep(1000);

  // Set up the configuration
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await sleep(1000);

  // Inject sample configuration via storage
  await page.evaluate(async (config) => {
    await chrome.storage.sync.set({ config });
  }, SAMPLE_CONFIG);

  // Reload options page to show the configuration
  await page.reload();
  await sleep(1000);

  // Screenshot 1: Options page with groups configured
  console.log('Taking screenshot of options page...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '01-options-page.png'),
    fullPage: false
  });

  // Screenshot 2: Popup as standalone page
  console.log('Taking screenshot of popup...');
  const popupPage = await context.newPage();
  await popupPage.setViewportSize({ width: 320, height: 400 });
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await sleep(500);

  await popupPage.screenshot({
    path: path.join(SCREENSHOTS_DIR, '02-popup.png')
  });

  // For full browser screenshots with tabs, we need a different approach
  // Create a visual demo by opening tabs and taking full page screenshots

  console.log('Creating demo windows with tabs...');

  // Open Development tabs
  const devPage1 = await context.newPage();
  await devPage1.goto('https://github.com');
  await sleep(2000);

  const devPage2 = await context.newPage();
  await devPage2.goto('https://stackoverflow.com');
  await sleep(2000);

  // Take a screenshot showing multiple tabs
  console.log('Taking screenshot of GitHub tab...');
  await devPage1.screenshot({
    path: path.join(SCREENSHOTS_DIR, '03-github-tab.png')
  });

  console.log('\n✅ Screenshots saved to:', SCREENSHOTS_DIR);
  console.log('\nFiles created:');
  fs.readdirSync(SCREENSHOTS_DIR).forEach(file => {
    console.log(`  - ${file}`);
  });

  console.log('\n⚠️  Note: For Chrome Web Store, you may want to manually take');
  console.log('   screenshots showing the popup dropdown and labeled tab groups,');
  console.log('   as these require interacting with browser chrome UI.');

  // Keep browser open for manual screenshots
  console.log('\n🖥️  Browser is open. Take additional manual screenshots if needed.');
  console.log('   Press Ctrl+C to close when done.\n');

  // Wait indefinitely (user will Ctrl+C)
  await new Promise(() => {});
}

main().catch(console.error);
