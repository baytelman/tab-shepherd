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
  console.log('Tab Shepherd bindWindow called:', { windowId, groupName });
  const bindings = await getWindowBindings();

  // Ensure only ONE window is bound to this group - unbind others first
  for (const [wid, gname] of Object.entries(bindings)) {
    if (gname === groupName && parseInt(wid, 10) !== windowId) {
      delete bindings[wid];
      console.log(`Tab Shepherd: Unbound window ${wid} from "${groupName}" (new binding to ${windowId})`);
    }
  }

  bindings[windowId] = groupName;
  await saveWindowBindings(bindings);
  console.log('Tab Shepherd bindWindow saved:', bindings);
}

async function unbindWindow(windowId) {
  const bindings = await getWindowBindings();
  delete bindings[windowId];
  await saveWindowBindings(bindings);
}

// ============================================================================
// Pattern Matching
// ============================================================================

function matchesPattern(text, pattern, isSimpleMode = false) {
  if (!text || !pattern) return false;
  try {
    if (isSimpleMode) {
      // Simple mode: case-insensitive contains
      return text.toLowerCase().includes(pattern.toLowerCase());
    } else {
      // Regex mode
      const regex = new RegExp(pattern, 'i');
      return regex.test(text);
    }
  } catch (e) {
    console.error(`Invalid pattern: ${pattern}`, e);
    return false;
  }
}

function tabMatchesGroup(url, title, group) {
  const isSimple = group.mode === 'simple';
  // Check if URL or title matches any pattern in the group
  return group.patterns.some(pattern =>
    matchesPattern(url, pattern, isSimple) || matchesPattern(title, pattern, isSimple)
  );
}

// Returns match info: { group, matchType: 'title' | 'url' | null }
function getMatchInfo(url, title, group) {
  const isSimple = group.mode === 'simple';

  // Check title first (higher priority)
  const titleMatches = group.patterns.some(pattern => matchesPattern(title, pattern, isSimple));
  if (titleMatches) {
    return { group, matchType: 'title' };
  }

  // Then check URL
  const urlMatches = group.patterns.some(pattern => matchesPattern(url, pattern, isSimple));
  if (urlMatches) {
    return { group, matchType: 'url' };
  }

  return null;
}

async function findMatchingGroup(url, title) {
  const config = await getConfig();
  if (!config.enabled) return null;

  // Collect all matching groups with their match type
  const matches = [];
  for (const group of config.groups) {
    const matchInfo = getMatchInfo(url, title, group);
    if (matchInfo) {
      matches.push(matchInfo);
    }
  }

  if (matches.length === 0) return null;

  // Sort matches:
  // 1. Title matches before URL matches
  // 2. Alphabetically by group name if same match type
  matches.sort((a, b) => {
    // Title matches have priority over URL matches
    if (a.matchType === 'title' && b.matchType === 'url') return -1;
    if (a.matchType === 'url' && b.matchType === 'title') return 1;
    // Same match type: sort alphabetically by group name
    return a.group.name.localeCompare(b.group.name);
  });

  return matches[0].group;
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

      // Check if any tab in this window matches the group (by URL or title)
      const hasMatchingTab = window.tabs?.some(tab =>
        tab.url && tabMatchesGroup(tab.url, tab.title, group)
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

async function handleTabNavigation(tabId, url, title, currentWindowId) {
  const config = await getConfig();
  if (!config.enabled) return;

  // Skip chrome:// and other internal URLs
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    return;
  }

  const matchingGroup = await findMatchingGroup(url, title);
  const bindings = await getWindowBindings();
  const currentWindowGroup = bindings[currentWindowId];

  if (matchingGroup) {
    // If tab is already in the correct window, do nothing
    if (currentWindowGroup === matchingGroup.name) return;

    // Only move if the group is assigned to a window
    let targetWindowId = await findWindowForGroup(matchingGroup.name);

    if (targetWindowId && targetWindowId !== currentWindowId) {
      // Move tab to existing assigned window
      await moveTabToWindow(tabId, targetWindowId);
      console.log(`Tab Shepherd: Moved tab to "${matchingGroup.name}" window (matched URL or title)`);
    }
    // If no window is assigned to this group, leave the tab where it is
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

// Listen for tab URL or title changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Act when URL changes or title changes (title often updates after page load)
  if (changeInfo.url || changeInfo.title) {
    await handleTabNavigation(tabId, tab.url, tab.title, tab.windowId);
  }
});

// Listen for new tabs
chrome.tabs.onCreated.addListener(async (tab) => {
  // New tabs often start with chrome://newtab, wait for actual navigation
  if (tab.pendingUrl && !tab.pendingUrl.startsWith('chrome://')) {
    await handleTabNavigation(tab.id, tab.pendingUrl, tab.title, tab.windowId);
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
  console.log('Tab Shepherd: sortAllTabs called', { enabled: config.enabled, groupCount: config.groups.length });

  if (!config.enabled || config.groups.length === 0) return { moved: 0, errors: [] };

  let movedCount = 0;
  const errors = [];

  // Process each group in priority order to avoid conflicts
  const sortedGroups = [...config.groups].sort((a, b) => a.priority - b.priority);
  console.log('Tab Shepherd: Processing groups in order:', sortedGroups.map(g => `${g.name} (pri=${g.priority}, mode=${g.mode})`));

  for (const group of sortedGroups) {
    // Re-fetch windows and bindings for each group to get fresh state
    const windows = await chrome.windows.getAll({ populate: true });
    const bindings = await getWindowBindings();

    console.log(`Tab Shepherd: Processing group "${group.name}" with patterns:`, group.patterns);
    console.log('Tab Shepherd: Current bindings:', bindings);

    // Find or establish the target window for this group
    let targetWindowId = await findWindowForGroup(group.name);
    console.log(`Tab Shepherd: Target window for "${group.name}":`, targetWindowId);

    // Collect tabs that match this group but aren't in the right window
    const tabsToMove = [];
    for (const window of windows) {
      if (window.type !== 'normal') continue;

      for (const tab of window.tabs || []) {
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
          continue;
        }

        // Check if this tab matches the current group
        const matches = tabMatchesGroup(tab.url, tab.title, group);
        if (!matches) continue;

        console.log(`Tab Shepherd: Tab matches "${group.name}":`, { url: tab.url, title: tab.title, windowId: window.id });

        // Skip if already in the correct window
        const currentWindowGroup = bindings[window.id];
        if (currentWindowGroup === group.name) {
          console.log(`Tab Shepherd: Tab already in correct window for "${group.name}"`);
          continue;
        }

        // Skip if in a window bound to a HIGHER priority group
        if (currentWindowGroup) {
          const currentGroupConfig = config.groups.find(g => g.name === currentWindowGroup);
          if (currentGroupConfig && currentGroupConfig.priority < group.priority) {
            console.log(`Tab Shepherd: Tab in higher-priority window "${currentWindowGroup}", not moving`);
            continue; // Higher priority group owns this window, don't steal tabs
          }
        }

        console.log(`Tab Shepherd: Will move tab to "${group.name}"`);
        tabsToMove.push({ tab, sourceWindowId: window.id });
      }
    }

    // Process moves for this group
    for (const { tab, sourceWindowId } of tabsToMove) {
      try {
        // Re-check target window (might have been created in previous iteration)
        targetWindowId = await findWindowForGroup(group.name);

        // Verify tab still exists and is in expected window
        let currentTab;
        try {
          currentTab = await chrome.tabs.get(tab.id);
        } catch (e) {
          continue; // Tab no longer exists
        }

        // Only move if the group has an assigned window
        if (targetWindowId && targetWindowId !== currentTab.windowId) {
          await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
          movedCount++;
          console.log(`Tab Shepherd: Moved tab to "${group.name}" window`);
        }
        // If no window is assigned to this group, skip this tab
      } catch (e) {
        errors.push(`Failed to move tab "${tab.title}": ${e.message}`);
      }
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

        // Get all tab groups
        const allTabGroups = await chrome.tabGroups.query({});
        const tabGroupMap = {};
        for (const group of allTabGroups) {
          tabGroupMap[group.id] = group.title || null;
        }

        const windowList = allWindows
          .filter(w => w.type === 'normal')
          .map(w => {
            // Get first non-chrome tab for fallback
            const firstTab = w.tabs?.find(t => t.url && !t.url.startsWith('chrome://'));
            const tabCount = w.tabs?.length || 0;

            // Find first tab group name in this window
            let tabGroupName = null;
            for (const tab of w.tabs || []) {
              if (tab.groupId && tab.groupId !== -1 && tabGroupMap[tab.groupId]) {
                tabGroupName = tabGroupMap[tab.groupId];
                break;
              }
            }

            return {
              id: w.id,
              tabCount,
              tabGroupName,
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

      case 'testPatterns':
        // Test patterns against all open tabs
        const testWindows = await chrome.windows.getAll({ populate: true });
        const testBindings = await getWindowBindings();
        const patterns = message.patterns || [];
        const isSimpleMode = message.simpleMode || false;

        const allTabs = [];
        for (const win of testWindows) {
          if (win.type !== 'normal') continue;
          const windowGroup = testBindings[win.id] || null;

          for (const tab of win.tabs || []) {
            if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
              continue;
            }

            // Test each pattern
            let matches = false;
            for (const pattern of patterns) {
              if (!pattern.trim()) continue;
              try {
                if (isSimpleMode) {
                  // Simple "contains" mode (case-insensitive)
                  const lowerPattern = pattern.toLowerCase();
                  matches = (tab.url && tab.url.toLowerCase().includes(lowerPattern)) ||
                            (tab.title && tab.title.toLowerCase().includes(lowerPattern));
                } else {
                  // Regex mode
                  const regex = new RegExp(pattern, 'i');
                  matches = regex.test(tab.url) || regex.test(tab.title || '');
                }
                if (matches) break;
              } catch (e) {
                // Invalid regex, skip
              }
            }

            allTabs.push({
              id: tab.id,
              url: tab.url,
              title: tab.title || '(no title)',
              windowId: win.id,
              windowGroup,
              matches
            });
          }
        }
        sendResponse(allTabs);
        break;

      case 'identifyWindow':
        // Flash/focus a window to help user identify it
        try {
          const targetWin = await chrome.windows.get(message.windowId);
          // Focus the window
          await chrome.windows.update(message.windowId, { focused: true });
          sendResponse({ success: true });
        } catch (e) {
          sendResponse({ error: 'Window not found' });
        }
        break;

      case 'labelWindow':
        // Create a tab group for all tabs in the window with the bound group name
        try {
          const labelBindings = await getWindowBindings();
          const groupName = labelBindings[message.windowId];

          if (!groupName) {
            sendResponse({ error: 'Window not assigned to a group' });
            break;
          }

          // Get all tabs in the window
          const windowTabs = await chrome.tabs.query({ windowId: message.windowId });
          const tabIds = windowTabs
            .filter(t => !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'))
            .map(t => t.id);

          if (tabIds.length === 0) {
            sendResponse({ error: 'No tabs to group' });
            break;
          }

          // Check if there's already a tab group with this name in the window
          const existingGroups = await chrome.tabGroups.query({ windowId: message.windowId });
          let existingGroupId = null;
          for (const g of existingGroups) {
            if (g.title === groupName) {
              existingGroupId = g.id;
              break;
            }
          }

          if (existingGroupId) {
            // Add tabs to existing group
            await chrome.tabs.group({ tabIds, groupId: existingGroupId });
          } else {
            // Create new group with unique color
            const newGroupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: message.windowId } });

            // Pick a color not used by other tab groups across all windows
            const TAB_GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];
            const allTabGroups = await chrome.tabGroups.query({});
            const usedColors = new Set(allTabGroups.map(g => g.color));
            const availableColor = TAB_GROUP_COLORS.find(c => !usedColors.has(c)) || TAB_GROUP_COLORS[0];

            await chrome.tabGroups.update(newGroupId, { title: groupName, color: availableColor, collapsed: false });
          }

          sendResponse({ success: true });
        } catch (e) {
          console.error('Failed to label window:', e);
          sendResponse({ error: e.message });
        }
        break;

      case 'getAllTabs':
        // Get all tabs for pattern testing preview
        const previewWindows = await chrome.windows.getAll({ populate: true });
        const previewBindings = await getWindowBindings();
        const tabList = [];

        for (const win of previewWindows) {
          if (win.type !== 'normal') continue;
          for (const tab of win.tabs || []) {
            if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
              continue;
            }
            tabList.push({
              id: tab.id,
              url: tab.url,
              title: tab.title || '(no title)',
              windowId: win.id,
              windowGroup: previewBindings[win.id] || null
            });
          }
        }
        sendResponse(tabList);
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
