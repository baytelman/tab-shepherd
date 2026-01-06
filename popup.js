// Tab Shepherd - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const enableToggle = document.getElementById('enableToggle');
  const windowGroupSelect = document.getElementById('windowGroup');
  const noGroupsMessage = document.getElementById('noGroupsMessage');
  const sortAllBtn = document.getElementById('sortAllBtn');
  const optionsBtn = document.getElementById('optionsBtn');
  const statusDiv = document.getElementById('status');

  // Load current state
  async function loadState() {
    const [config, currentWindow] = await Promise.all([
      sendMessage({ action: 'getConfig' }),
      sendMessage({ action: 'getCurrentWindow' })
    ]);

    // Set enable toggle
    enableToggle.checked = config.enabled;

    // Populate groups dropdown
    windowGroupSelect.innerHTML = '<option value="">(unassigned)</option>';

    if (config.groups.length === 0) {
      noGroupsMessage.style.display = 'block';
      windowGroupSelect.disabled = true;
    } else {
      noGroupsMessage.style.display = 'none';
      windowGroupSelect.disabled = false;

      // Sort by priority
      const sortedGroups = [...config.groups].sort((a, b) => a.priority - b.priority);
      for (const group of sortedGroups) {
        const option = document.createElement('option');
        option.value = group.name;
        option.textContent = group.name;
        if (currentWindow.groupName === group.name) {
          option.selected = true;
        }
        windowGroupSelect.appendChild(option);
      }
    }
  }

  // Helper to send messages to background
  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  }

  // Show status message
  function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }

  // Event: Toggle enabled
  enableToggle.addEventListener('change', async () => {
    const config = await sendMessage({ action: 'getConfig' });
    config.enabled = enableToggle.checked;
    await sendMessage({ action: 'saveConfig', config });
    showStatus(config.enabled ? 'Tab Shepherd enabled' : 'Tab Shepherd disabled', 'info');
  });

  // Event: Change window group
  windowGroupSelect.addEventListener('change', async () => {
    const currentWindow = await sendMessage({ action: 'getCurrentWindow' });
    const selectedGroup = windowGroupSelect.value;

    if (selectedGroup) {
      await sendMessage({
        action: 'bindWindow',
        windowId: currentWindow.windowId,
        groupName: selectedGroup
      });
      showStatus(`Window assigned to "${selectedGroup}"`, 'success');
    } else {
      await sendMessage({
        action: 'unbindWindow',
        windowId: currentWindow.windowId
      });
      showStatus('Window unassigned', 'info');
    }
  });

  // Event: Sort all tabs
  sortAllBtn.addEventListener('click', async () => {
    sortAllBtn.disabled = true;
    sortAllBtn.innerHTML = '<span>&#x21bb;</span> Sorting...';

    try {
      const result = await sendMessage({ action: 'sortAllTabs' });

      if (result.moved > 0) {
        showStatus(`Moved ${result.moved} tab${result.moved > 1 ? 's' : ''}`, 'success');
      } else {
        showStatus('All tabs are already sorted', 'info');
      }

      if (result.errors.length > 0) {
        console.error('Sort errors:', result.errors);
      }
    } catch (e) {
      showStatus('Error sorting tabs', 'error');
      console.error(e);
    } finally {
      sortAllBtn.disabled = false;
      sortAllBtn.innerHTML = '<span>&#x21bb;</span> Sort All Tabs';
    }
  });

  // Event: Open options
  optionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Initial load
  await loadState();
});
