/**
 * Tab Shepherd - Happy Path Tests
 *
 * Tests the core tab sorting functionality to ensure tabs are routed
 * to the correct windows based on URL/title patterns.
 */

// ============================================================================
// Chrome API Mocks
// ============================================================================

let mockStorage = {};
let mockWindows = [];
let mockTabs = [];
let nextWindowId = 1000;
let nextTabId = 2000;

const chrome = {
  storage: {
    sync: {
      get: jest.fn(async (key) => {
        return { [key]: mockStorage[key] };
      }),
      set: jest.fn(async (data) => {
        Object.assign(mockStorage, data);
      })
    },
    local: {
      get: jest.fn(async (key) => {
        return { [key]: mockStorage[key] };
      }),
      set: jest.fn(async (data) => {
        Object.assign(mockStorage, data);
      })
    }
  },
  windows: {
    getAll: jest.fn(async ({ populate }) => {
      if (populate) {
        return mockWindows.map(w => ({
          ...w,
          tabs: mockTabs.filter(t => t.windowId === w.id)
        }));
      }
      return mockWindows;
    }),
    get: jest.fn(async (windowId) => {
      const win = mockWindows.find(w => w.id === windowId);
      if (!win) throw new Error('Window not found');
      return win;
    }),
    create: jest.fn(async ({ tabId, focused }) => {
      const newWindow = { id: nextWindowId++, type: 'normal', focused };
      mockWindows.push(newWindow);

      // Move the tab to the new window
      const tab = mockTabs.find(t => t.id === tabId);
      if (tab) {
        tab.windowId = newWindow.id;
      }

      return newWindow;
    }),
    update: jest.fn(async (windowId, updateInfo) => {
      const win = mockWindows.find(w => w.id === windowId);
      if (win) Object.assign(win, updateInfo);
      return win;
    })
  },
  tabs: {
    get: jest.fn(async (tabId) => {
      const tab = mockTabs.find(t => t.id === tabId);
      if (!tab) throw new Error('Tab not found');
      return tab;
    }),
    move: jest.fn(async (tabId, { windowId, index }) => {
      const tab = mockTabs.find(t => t.id === tabId);
      if (tab) {
        tab.windowId = windowId;
      }
      return tab;
    }),
    query: jest.fn(async () => mockTabs)
  },
  tabGroups: {
    query: jest.fn(async () => [])
  },
  runtime: {
    onMessage: { addListener: jest.fn() },
    onStartup: { addListener: jest.fn() },
    onInstalled: { addListener: jest.fn() }
  }
};

global.chrome = chrome;

// ============================================================================
// Import the module under test (we'll inline the key functions)
// ============================================================================

// Since background.js uses top-level await and chrome listeners,
// we'll extract and test the core logic functions directly

async function getConfig() {
  const result = await chrome.storage.sync.get('config');
  return result.config || { enabled: true, groups: [], catchAllWindowId: null };
}

async function getWindowBindings() {
  const result = await chrome.storage.local.get('windowBindings');
  return result.windowBindings || {};
}

async function saveWindowBindings(bindings) {
  await chrome.storage.local.set({ windowBindings: bindings });
}

async function bindWindow(windowId, groupName) {
  const bindings = await getWindowBindings();

  // Ensure only ONE window is bound to this group - unbind others first
  for (const [wid, gname] of Object.entries(bindings)) {
    if (gname === groupName && parseInt(wid, 10) !== windowId) {
      delete bindings[wid];
    }
  }

  bindings[windowId] = groupName;
  await saveWindowBindings(bindings);
}

function matchesPattern(text, pattern, isSimpleMode = false) {
  if (!text) return false;
  try {
    if (isSimpleMode) {
      return text.toLowerCase().includes(pattern.toLowerCase());
    }
    const regex = new RegExp(pattern, 'i');
    return regex.test(text);
  } catch (e) {
    return false;
  }
}

function tabMatchesGroup(url, title, group) {
  const isSimple = group.mode === 'simple';
  return group.patterns.some(pattern =>
    matchesPattern(url, pattern, isSimple) || matchesPattern(title, pattern, isSimple)
  );
}

async function findWindowForGroup(groupName) {
  const bindings = await getWindowBindings();

  for (const [windowIdStr, boundGroup] of Object.entries(bindings)) {
    if (boundGroup === groupName) {
      const windowId = parseInt(windowIdStr, 10);
      try {
        await chrome.windows.get(windowId);
        return windowId;
      } catch (e) {
        delete bindings[windowIdStr];
        await saveWindowBindings(bindings);
      }
    }
  }

  return null;
}

async function createWindowForGroup(groupName, tabId) {
  const newWindow = await chrome.windows.create({
    tabId: tabId,
    focused: true
  });

  await bindWindow(newWindow.id, groupName);
  return newWindow.id;
}

async function sortAllTabs() {
  const config = await getConfig();
  if (!config.enabled || config.groups.length === 0) return { moved: 0, errors: [] };

  let movedCount = 0;
  const errors = [];

  const sortedGroups = [...config.groups].sort((a, b) => a.priority - b.priority);

  for (const group of sortedGroups) {
    const windows = await chrome.windows.getAll({ populate: true });
    const bindings = await getWindowBindings();

    let targetWindowId = await findWindowForGroup(group.name);

    const tabsToMove = [];
    for (const window of windows) {
      if (window.type !== 'normal') continue;

      for (const tab of window.tabs || []) {
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
          continue;
        }

        if (!tabMatchesGroup(tab.url, tab.title, group)) continue;

        const currentWindowGroup = bindings[window.id];
        if (currentWindowGroup === group.name) continue;

        if (currentWindowGroup) {
          const currentGroupConfig = config.groups.find(g => g.name === currentWindowGroup);
          if (currentGroupConfig && currentGroupConfig.priority < group.priority) {
            continue;
          }
        }

        tabsToMove.push({ tab, sourceWindowId: window.id });
      }
    }

    for (const { tab } of tabsToMove) {
      try {
        targetWindowId = await findWindowForGroup(group.name);

        let currentTab;
        try {
          currentTab = await chrome.tabs.get(tab.id);
        } catch (e) {
          continue;
        }

        if (targetWindowId && targetWindowId !== currentTab.windowId) {
          await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
          movedCount++;
        } else if (!targetWindowId) {
          targetWindowId = await createWindowForGroup(group.name, tab.id);
          movedCount++;
        }
      } catch (e) {
        errors.push(`Failed to move tab "${tab.title}": ${e.message}`);
      }
    }
  }

  return { moved: movedCount, errors };
}

// ============================================================================
// Test Helpers
// ============================================================================

function resetMocks() {
  mockStorage = {};
  mockWindows = [];
  mockTabs = [];
  nextWindowId = 1000;
  nextTabId = 2000;
  jest.clearAllMocks();
}

function createWindow(id = null) {
  const win = { id: id || nextWindowId++, type: 'normal', focused: false };
  mockWindows.push(win);
  return win;
}

function createTab(windowId, url, title = '') {
  const tab = { id: nextTabId++, windowId, url, title: title || url };
  mockTabs.push(tab);
  return tab;
}

function setConfig(config) {
  mockStorage.config = config;
}

function setBindings(bindings) {
  mockStorage.windowBindings = bindings;
}

function getTabsByWindow(windowId) {
  return mockTabs.filter(t => t.windowId === windowId);
}

// ============================================================================
// Happy Path Tests
// ============================================================================

describe('Tab Shepherd - Happy Path Tests', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('Basic Sorting', () => {
    test('moves tab to correct window when pattern matches URL', async () => {
      // Setup: Window A (3003), Window B (3004), tab in wrong window
      const windowA = createWindow(100);
      const windowB = createWindow(200);

      createTab(100, 'http://localhost:3003/app', 'App 3003');
      createTab(200, 'http://localhost:3004/app', 'App 3004');
      const misplacedTab = createTab(200, 'http://localhost:3003/other', 'Other 3003'); // In wrong window!

      setConfig({
        enabled: true,
        groups: [
          { name: '3003', patterns: ['localhost:3003'], priority: 0, mode: 'simple' },
          { name: '3004', patterns: ['localhost:3004'], priority: 1, mode: 'simple' }
        ]
      });

      setBindings({ 100: '3003', 200: '3004' });

      // Act
      const result = await sortAllTabs();

      // Assert
      expect(result.moved).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(misplacedTab.windowId).toBe(100); // Should now be in window A
    });

    test('moves tab to correct window when pattern matches title', async () => {
      // Setup: Tab with matching title but non-matching URL
      const windowA = createWindow(100);
      const windowB = createWindow(200);

      createTab(100, 'http://localhost:3003/app', 'Development Server 3003');
      const misplacedTab = createTab(200, 'http://example.com/page', 'Feature branch - 3003'); // Title matches!

      setConfig({
        enabled: true,
        groups: [
          { name: '3003', patterns: ['3003'], priority: 0, mode: 'simple' }
        ]
      });

      setBindings({ 100: '3003' });

      // Act
      const result = await sortAllTabs();

      // Assert
      expect(result.moved).toBe(1);
      expect(misplacedTab.windowId).toBe(100);
    });

    test('creates new window when no window is bound to group', async () => {
      // Setup: Unbound window with a tab that matches a group
      const windowA = createWindow(100); // Unbound window

      const newGroupTab = createTab(100, 'http://localhost:3003/app', 'App 3003');

      setConfig({
        enabled: true,
        groups: [
          { name: '3003', patterns: ['localhost:3003'], priority: 0, mode: 'simple' }
        ]
      });

      setBindings({}); // No windows bound

      // Act
      const result = await sortAllTabs();

      // Assert
      expect(result.moved).toBe(1);
      expect(newGroupTab.windowId).not.toBe(100); // Should be in a NEW window
      expect(mockWindows.length).toBe(2); // New window was created

      // Verify the new window is bound to the group
      const bindings = await getWindowBindings();
      expect(Object.values(bindings)).toContain('3003');
    });

    test('tabs in higher-priority window stay put even if matching lower-priority group', async () => {
      // Setup: Tab in high-priority window matches a lower-priority group
      // This is intentional behavior - higher priority windows "own" their tabs
      const windowA = createWindow(100);

      createTab(100, 'http://localhost:3003/app', 'App 3003');
      const mixedTab = createTab(100, 'http://localhost:3004/app', 'App 3004'); // Matches lower priority

      setConfig({
        enabled: true,
        groups: [
          { name: '3003', patterns: ['localhost:3003'], priority: 0, mode: 'simple' }, // Higher priority
          { name: '3004', patterns: ['localhost:3004'], priority: 1, mode: 'simple' }  // Lower priority
        ]
      });

      setBindings({ 100: '3003' }); // Window bound to higher priority group

      // Act
      const result = await sortAllTabs();

      // Assert: Tab stays in the higher-priority window (not moved)
      expect(result.moved).toBe(0);
      expect(mixedTab.windowId).toBe(100);
    });

    test('does not move tab already in correct window', async () => {
      // Setup: All tabs already in correct windows
      const windowA = createWindow(100);
      const windowB = createWindow(200);

      createTab(100, 'http://localhost:3003/app', 'App 3003');
      createTab(200, 'http://localhost:3004/app', 'App 3004');

      setConfig({
        enabled: true,
        groups: [
          { name: '3003', patterns: ['localhost:3003'], priority: 0, mode: 'simple' },
          { name: '3004', patterns: ['localhost:3004'], priority: 1, mode: 'simple' }
        ]
      });

      setBindings({ 100: '3003', 200: '3004' });

      // Act
      const result = await sortAllTabs();

      // Assert
      expect(result.moved).toBe(0);
      expect(chrome.tabs.move).not.toHaveBeenCalled();
    });
  });

  describe('User Bug Scenario - Multiple Windows Same Group', () => {
    test('scenario: Window A=3003, new Window B=3004, sort should not create duplicate bindings', async () => {
      /**
       * User's original bug:
       * 1. Window A assigned to 3003
       * 2. New window B assigned to 3004
       * 3. Click Sort All Tabs
       * 4. Result: New window C created for 3003, A shows 3004, B unassigned
       *
       * Expected: No new windows created, bindings stay correct
       */
      const windowA = createWindow(100);
      const windowB = createWindow(200);

      // Window A has 3003 tab
      createTab(100, 'http://localhost:3003/app', 'App 3003');
      // Window B has 3004 tab
      createTab(200, 'http://localhost:3004/app', 'App 3004');

      setConfig({
        enabled: true,
        groups: [
          { name: '3003', patterns: ['localhost:3003'], priority: 0, mode: 'simple' },
          { name: '3004', patterns: ['localhost:3004'], priority: 1, mode: 'simple' }
        ]
      });

      setBindings({ 100: '3003', 200: '3004' });

      // Act
      const result = await sortAllTabs();
      const bindingsAfter = await getWindowBindings();

      // Assert
      expect(result.moved).toBe(0); // No tabs should move
      expect(result.errors).toHaveLength(0);
      expect(mockWindows.length).toBe(2); // No new windows created
      expect(bindingsAfter[100]).toBe('3003'); // Window A still 3003
      expect(bindingsAfter[200]).toBe('3004'); // Window B still 3004
    });

    test('scenario: tabs in unbound window get sorted to correct bound windows', async () => {
      /**
       * Window A bound to 3003, Window B bound to 3004, Window C unbound
       * Window C has mixed tabs (some 3003, some 3004)
       * Sort should move tabs to correct windows
       */
      const windowA = createWindow(100);
      const windowB = createWindow(200);
      const windowC = createWindow(300); // Unbound

      createTab(100, 'http://localhost:3003/main', 'Main 3003');
      createTab(200, 'http://localhost:3004/main', 'Main 3004');

      // Mixed tabs in unbound window
      const tab3003 = createTab(300, 'http://localhost:3003/other', 'Other 3003');
      const tab3004 = createTab(300, 'http://localhost:3004/other', 'Other 3004');

      setConfig({
        enabled: true,
        groups: [
          { name: '3003', patterns: ['localhost:3003'], priority: 0, mode: 'simple' },
          { name: '3004', patterns: ['localhost:3004'], priority: 1, mode: 'simple' }
        ]
      });

      setBindings({ 100: '3003', 200: '3004' }); // Window C not bound

      // Act
      const result = await sortAllTabs();

      // Assert
      expect(result.moved).toBe(2);
      expect(tab3003.windowId).toBe(100); // Moved to window A
      expect(tab3004.windowId).toBe(200); // Moved to window B
    });

    test('bindWindow enforces one window per group', async () => {
      // Setup: Window A already bound to 3003
      setBindings({ 100: '3003' });

      // Act: Bind Window B to 3003
      await bindWindow(200, '3003');

      // Assert: Window A should be unbound, only Window B bound to 3003
      const bindings = await getWindowBindings();
      expect(bindings[100]).toBeUndefined();
      expect(bindings[200]).toBe('3003');
    });
  });

  describe('Priority Handling', () => {
    test('higher priority group processes first', async () => {
      // Setup: Tab matches multiple groups, should go to higher priority
      const windowA = createWindow(100);
      const windowB = createWindow(200);

      createTab(100, 'http://localhost:3003/app', 'Work App');
      // This tab matches both "localhost" and "3004" patterns
      const multiMatchTab = createTab(200, 'http://localhost:3004/app', 'Dev App');

      setConfig({
        enabled: true,
        groups: [
          { name: 'Development', patterns: ['localhost'], priority: 0, mode: 'simple' }, // Higher priority
          { name: '3004', patterns: ['3004'], priority: 1, mode: 'simple' }
        ]
      });

      setBindings({ 100: 'Development' });

      // Act
      const result = await sortAllTabs();

      // Assert: Tab should go to Development window (higher priority)
      expect(multiMatchTab.windowId).toBe(100);
    });

    test('does not steal tabs from higher priority window', async () => {
      // Setup: Tab in high-priority window matches low-priority group too
      const windowA = createWindow(100);
      const windowB = createWindow(200);

      // This tab is in "Development" window and matches localhost:3004
      const tab = createTab(100, 'http://localhost:3004/app', 'Dev App');

      setConfig({
        enabled: true,
        groups: [
          { name: 'Development', patterns: ['localhost'], priority: 0, mode: 'simple' }, // Higher priority
          { name: '3004', patterns: ['3004'], priority: 1, mode: 'simple' }
        ]
      });

      setBindings({ 100: 'Development', 200: '3004' });

      // Act
      const result = await sortAllTabs();

      // Assert: Tab should stay in Development (won't be stolen by lower priority)
      expect(tab.windowId).toBe(100);
      expect(result.moved).toBe(0);
    });
  });

  describe('Regex Mode', () => {
    test('matches tabs using regex patterns', async () => {
      const windowA = createWindow(100);
      const windowB = createWindow(200);

      createTab(100, 'http://localhost:3000/app', 'App 3000');
      const tab3001 = createTab(200, 'http://localhost:3001/app', 'App 3001');
      const tab3002 = createTab(200, 'http://localhost:3002/app', 'App 3002');

      setConfig({
        enabled: true,
        groups: [
          { name: 'Dev Ports', patterns: ['localhost:300[0-2]'], priority: 0, mode: 'regex' }
        ]
      });

      setBindings({ 100: 'Dev Ports' });

      // Act
      const result = await sortAllTabs();

      // Assert: Both tabs should move to window A (regex matches 3000-3002)
      expect(result.moved).toBe(2);
      expect(tab3001.windowId).toBe(100);
      expect(tab3002.windowId).toBe(100);
    });
  });

  describe('Edge Cases', () => {
    test('skips chrome:// URLs', async () => {
      const windowA = createWindow(100);

      createTab(100, 'http://localhost:3003/app', 'App');
      createTab(100, 'chrome://settings', 'Settings');
      createTab(100, 'chrome-extension://abc123/popup.html', 'Extension');

      setConfig({
        enabled: true,
        groups: [
          { name: '3003', patterns: ['localhost:3003'], priority: 0, mode: 'simple' }
        ]
      });

      setBindings({ 100: '3003' });

      const result = await sortAllTabs();

      expect(result.moved).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    test('handles disabled extension', async () => {
      const windowA = createWindow(100);
      createTab(100, 'http://localhost:3003/app', 'App');

      setConfig({
        enabled: false,
        groups: [
          { name: '3003', patterns: ['localhost:3003'], priority: 0, mode: 'simple' }
        ]
      });

      const result = await sortAllTabs();

      expect(result.moved).toBe(0);
    });

    test('handles empty groups', async () => {
      const windowA = createWindow(100);
      createTab(100, 'http://localhost:3003/app', 'App');

      setConfig({
        enabled: true,
        groups: []
      });

      const result = await sortAllTabs();

      expect(result.moved).toBe(0);
    });

    test('handles window that no longer exists', async () => {
      // Setup: Binding references a window that doesn't exist
      setBindings({ 999: '3003' }); // Window 999 doesn't exist

      const windowA = createWindow(100);
      const tab = createTab(100, 'http://localhost:3003/app', 'App');

      setConfig({
        enabled: true,
        groups: [
          { name: '3003', patterns: ['localhost:3003'], priority: 0, mode: 'simple' }
        ]
      });

      // Act
      const result = await sortAllTabs();

      // Assert: Should create new window since 999 doesn't exist
      expect(result.moved).toBe(1);
      expect(tab.windowId).not.toBe(100); // Moved to new window
    });
  });
});
