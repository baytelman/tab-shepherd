// Tab Shepherd - Background Service Worker
// Handles tab routing based on URL patterns

const DEFAULT_CONFIG = {
  enabled: true,
  groups: [],
  catchAllWindowId: null
};

// In-memory cache of window bindings (windowId -> groupName)
let windowBindings = {};

// ============================================================================
// Storage Helpers
// ============================================================================

async function getConfig() {
  const result = await chrome.storage.sync.get('config');
  return result.config || DEFAULT_CONFIG;
}

async function saveConfig(config) {
  await chrome.storage.sync.set({ config });
}

async function getWindowBindings() {
  const result = await chrome.storage.local.get('windowBindings');
  return result.windowBindings || {};
}

async function saveWindowBindings(bindings) {
  windowBindings = bindings;
  await chrome.storage.local.set({ windowBindings: bindings });
}

async function bindWindow(windowId, groupName) {
  const bindings = await getWindowBindings();
  bindings[windowId] = groupName;
  await saveWindowBindings(bindings);
}

async function unbindWindow(windowId) {
  const bindings = await getWindowBindings();
  delete bindings[windowId];
  await saveWindowBindings(bindings);
}

// ============================================================================
// Pattern Matching
// ============================================================================

function urlMatchesPattern(url, pattern) {
  try {
    const regex = new RegExp(pattern, 'i');
    return regex.test(url);
  } catch (e) {
    console.error(`Invalid regex pattern: ${pattern}`, e);
    return false;
  }
}

function urlMatchesGroup(url, group) {
  return group.patterns.some(pattern => urlMatchesPattern(url, pattern));
}

async function findMatchingGroup(url) {
  const config = await getConfig();
  if (!config.enabled) return null;

  // Groups are sorted by priority (lower number = higher priority)
  const sortedGroups = [...config.groups].sort((a, b) => a.priority - b.priority);

  for (const group of sortedGroups) {
    if (urlMatchesGroup(url, group)) {
      return group;
    }
  }

  return null;
}

// ============================================================================
// Window Management
// ============================================================================

async function findWindowForGroup(groupName) {
  const bindings = await getWindowBindings();

  // Find window ID bound to this group
  for (const [windowIdStr, boundGroup] of Object.entries(bindings)) {
    if (boundGroup === groupName) {
      const windowId = parseInt(windowIdStr, 10);
      // Verify window still exists
      try {
        await chrome.windows.get(windowId);
        return windowId;
      } catch (e) {
        // Window no longer exists, clean up binding
        delete bindings[windowIdStr];
        await saveWindowBindings(bindings);
      }
    }
  }

  return null;
}

async function createWindowForGroup(groupName, tabId) {
  // Create new window with the tab
  const newWindow = await chrome.windows.create({
    tabId: tabId,
    focused: true
  });

  // Bind the new window to this group
  await bindWindow(newWindow.id, groupName);

  return newWindow.id;
}

async function moveTabToWindow(tabId, windowId) {
  try {
    await chrome.tabs.move(tabId, { windowId: windowId, index: -1 });
    await chrome.windows.update(windowId, { focused: true });
    return true;
  } catch (e) {
    console.error('Failed to move tab:', e);
    return false;
  }
}

// ============================================================================
// Auto-Rebind on Startup
// ============================================================================

async function rebindWindowsOnStartup() {
  const config = await getConfig();
  if (!config.enabled || config.groups.length === 0) return;

  const windows = await chrome.windows.getAll({ populate: true });
  const newBindings = {};

  // For each group, find a window that has tabs matching its patterns
  for (const group of config.groups) {
    for (const window of windows) {
      // Skip if this window is already bound
      if (Object.values(newBindings).includes(group.name)) continue;
      if (newBindings[window.id]) continue;

      // Check if any tab in this window matches the group
      const hasMatchingTab = window.tabs?.some(tab =>
        tab.url && urlMatchesGroup(tab.url, group)
      );

      if (hasMatchingTab) {
        newBindings[window.id] = group.name;
        console.log(`Tab Shepherd: Bound window ${window.id} to group "${group.name}"`);
        break;
      }
    }
  }

  await saveWindowBindings(newBindings);
  console.log('Tab Shepherd: Window bindings restored', newBindings);
}

// ============================================================================
// Tab Event Handlers
// ============================================================================

async function handleTabNavigation(tabId, url, currentWindowId) {
  const config = await getConfig();
  if (!config.enabled) return;

  // Skip chrome:// and other internal URLs
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    return;
  }

  const matchingGroup = await findMatchingGroup(url);
  const bindings = await getWindowBindings();
  const currentWindowGroup = bindings[currentWindowId];

  if (matchingGroup) {
    // If tab is already in the correct window, do nothing
    if (currentWindowGroup === matchingGroup.name) return;

    // Find or create window for this group
    let targetWindowId = await findWindowForGroup(matchingGroup.name);

    if (targetWindowId && targetWindowId !== currentWindowId) {
      // Move tab to existing window
      await moveTabToWindow(tabId, targetWindowId);
      console.log(`Tab Shepherd: Moved tab to "${matchingGroup.name}" window`);
    } else if (!targetWindowId) {
      // Create new window for this group
      await createWindowForGroup(matchingGroup.name, tabId);
      console.log(`Tab Shepherd: Created new window for "${matchingGroup.name}"`);
    }
  } else if (config.catchAllWindowId) {
    // No matching group - use catch-all window if configured
    if (currentWindowId === config.catchAllWindowId) return;

    // Verify catch-all window still exists
    try {
      await chrome.windows.get(config.catchAllWindowId);
      await moveTabToWindow(tabId, config.catchAllWindowId);
      console.log(`Tab Shepherd: Moved unmatched tab to catch-all window`);
    } catch (e) {
      // Catch-all window no longer exists
      console.log(`Tab Shepherd: Catch-all window ${config.catchAllWindowId} no longer exists`);
    }
  }
}

// Listen for tab URL changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when URL changes (not on every update)
  if (changeInfo.url) {
    await handleTabNavigation(tabId, changeInfo.url, tab.windowId);
  }
});

// Listen for new tabs
chrome.tabs.onCreated.addListener(async (tab) => {
  // New tabs often start with chrome://newtab, wait for actual navigation
  if (tab.pendingUrl && !tab.pendingUrl.startsWith('chrome://')) {
    await handleTabNavigation(tab.id, tab.pendingUrl, tab.windowId);
  }
});

// Clean up bindings when windows are closed
chrome.windows.onRemoved.addListener(async (windowId) => {
  await unbindWindow(windowId);
  console.log(`Tab Shepherd: Unbound closed window ${windowId}`);
});

// ============================================================================
// Sort All Tabs
// ============================================================================

async function sortAllTabs() {
  const config = await getConfig();
  if (!config.enabled || config.groups.length === 0) return { moved: 0, errors: [] };

  const windows = await chrome.windows.getAll({ populate: true });
  const bindings = await getWindowBindings();
  let movedCount = 0;
  const errors = [];

  // Collect all tabs that need to move
  const tabsToMove = [];

  for (const window of windows) {
    for (const tab of window.tabs || []) {
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        continue;
      }

      const matchingGroup = await findMatchingGroup(tab.url);
      if (!matchingGroup) continue;

      const currentWindowGroup = bindings[window.id];
      if (currentWindowGroup !== matchingGroup.name) {
        tabsToMove.push({ tab, targetGroup: matchingGroup.name });
      }
    }
  }

  // Process moves
  for (const { tab, targetGroup } of tabsToMove) {
    try {
      let targetWindowId = await findWindowForGroup(targetGroup);

      if (targetWindowId && targetWindowId !== tab.windowId) {
        await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
        movedCount++;
      } else if (!targetWindowId) {
        await createWindowForGroup(targetGroup, tab.id);
        movedCount++;
      }
    } catch (e) {
      errors.push(`Failed to move tab "${tab.title}": ${e.message}`);
    }
  }

  return { moved: movedCount, errors };
}

// ============================================================================
// Message Handling (for popup and options page)
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.action) {
      case 'getConfig':
        sendResponse(await getConfig());
        break;

      case 'saveConfig':
        await saveConfig(message.config);
        sendResponse({ success: true });
        break;

      case 'getWindowBindings':
        sendResponse(await getWindowBindings());
        break;

      case 'bindWindow':
        await bindWindow(message.windowId, message.groupName);
        sendResponse({ success: true });
        break;

      case 'unbindWindow':
        await unbindWindow(message.windowId);
        sendResponse({ success: true });
        break;

      case 'getCurrentWindow':
        const window = await chrome.windows.getCurrent();
        const bindings = await getWindowBindings();
        sendResponse({
          windowId: window.id,
          groupName: bindings[window.id] || null
        });
        break;

      case 'sortAllTabs':
        const result = await sortAllTabs();
        sendResponse(result);
        break;

      case 'rebindWindows':
        await rebindWindowsOnStartup();
        sendResponse({ success: true });
        break;

      case 'getAllWindows':
        const allWindows = await chrome.windows.getAll({ populate: true });
        const allBindings = await getWindowBindings();
        const windowList = allWindows
          .filter(w => w.type === 'normal')
          .map(w => {
            // Get first non-chrome tab URL for identification
            const firstTab = w.tabs?.find(t => t.url && !t.url.startsWith('chrome://'));
            const tabCount = w.tabs?.length || 0;
            return {
              id: w.id,
              tabCount,
              firstTabUrl: firstTab?.url || '(empty)',
              firstTabTitle: firstTab?.title || '(no tabs)',
              boundGroup: allBindings[w.id] || null
            };
          });
        sendResponse(windowList);
        break;

      case 'bindWindowToGroup':
        // Unbind any window currently bound to this group first
        const currentBindings = await getWindowBindings();
        for (const [wid, gname] of Object.entries(currentBindings)) {
          if (gname === message.groupName && parseInt(wid) !== message.windowId) {
            delete currentBindings[wid];
          }
        }
        if (message.windowId) {
          currentBindings[message.windowId] = message.groupName;
        }
        await saveWindowBindings(currentBindings);
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }
  })();
  return true; // Keep message channel open for async response
});

// ============================================================================
// Initialization
// ============================================================================

chrome.runtime.onStartup.addListener(async () => {
  console.log('Tab Shepherd: Browser startup, rebinding windows...');
  await rebindWindowsOnStartup();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Tab Shepherd: Extension installed/updated');
  if (details.reason === 'install') {
    // Open options page on first install
    chrome.runtime.openOptionsPage();
  }
});

// Also rebind when service worker wakes up (in case of extension reload)
(async () => {
  console.log('Tab Shepherd: Service worker started');
  windowBindings = await getWindowBindings();
})();
