// Tab Shepherd - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const enableToggle = document.getElementById('enableToggle');
  const windowGroupSelect = document.getElementById('windowGroup');
  const noGroupsMessage = document.getElementById('noGroupsMessage');
  const sortAllBtn = document.getElementById('sortAllBtn');
  const labelWindowBtn = document.getElementById('labelWindowBtn');
  const optionsBtn = document.getElementById('optionsBtn');
  const statusDiv = document.getElementById('status');

  // Modal elements
  const reassignModal = document.getElementById('reassignModal');
  const modalMessage = document.getElementById('modalMessage');
  const modalReassign = document.getElementById('modalReassign');
  const modalGoto = document.getElementById('modalGoto');
  const modalCancel = document.getElementById('modalCancel');

  // State
  let currentWindowId = null;
  let currentGroupName = null;
  let pendingSelection = null;
  let groupAssignments = {}; // groupName -> windowId

  // Load current state
  async function loadState() {
    const [config, currentWindow, bindings] = await Promise.all([
      sendMessage({ action: 'getConfig' }),
      sendMessage({ action: 'getCurrentWindow' }),
      sendMessage({ action: 'getWindowBindings' })
    ]);

    currentWindowId = currentWindow.windowId;
    currentGroupName = currentWindow.groupName;

    // Build reverse map: groupName -> windowId
    groupAssignments = {};
    for (const [windowId, groupName] of Object.entries(bindings)) {
      groupAssignments[groupName] = parseInt(windowId, 10);
    }

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

      // Separate into unassigned and assigned groups
      const unassigned = [];
      const assigned = [];

      for (const group of config.groups) {
        const assignedWindowId = groupAssignments[group.name];
        if (assignedWindowId && assignedWindowId !== currentWindowId) {
          assigned.push(group);
        } else {
          unassigned.push(group);
        }
      }

      // Sort both alphabetically
      unassigned.sort((a, b) => a.name.localeCompare(b.name));
      assigned.sort((a, b) => a.name.localeCompare(b.name));

      // Add unassigned groups first
      for (const group of unassigned) {
        const option = document.createElement('option');
        option.value = group.name;
        option.textContent = group.name;
        if (currentGroupName === group.name) {
          option.selected = true;
        }
        windowGroupSelect.appendChild(option);
      }

      // Add separator if both lists have items
      if (unassigned.length > 0 && assigned.length > 0) {
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '── Assigned ──';
        windowGroupSelect.appendChild(separator);
      }

      // Add assigned groups with icon
      for (const group of assigned) {
        const option = document.createElement('option');
        option.value = group.name;
        option.textContent = `● ${group.name}`;
        option.dataset.assigned = 'true';
        option.dataset.windowId = groupAssignments[group.name];
        if (currentGroupName === group.name) {
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

  // Show modal
  function showModal(groupName, windowId) {
    pendingSelection = { groupName, windowId };
    modalMessage.textContent = `"${groupName}" is assigned to another window.`;
    reassignModal.style.display = 'block';
  }

  // Hide modal
  function hideModal() {
    reassignModal.style.display = 'none';
    pendingSelection = null;
  }

  // Assign group to current window
  async function assignGroup(groupName) {
    await sendMessage({
      action: 'bindWindow',
      windowId: currentWindowId,
      groupName: groupName
    });
    showStatus(`Window assigned to "${groupName}"`, 'success');
    await loadState();
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
    const selectedOption = windowGroupSelect.selectedOptions[0];
    const selectedGroup = windowGroupSelect.value;

    if (!selectedGroup) {
      // Unassigning
      await sendMessage({
        action: 'unbindWindow',
        windowId: currentWindowId
      });
      showStatus('Window unassigned', 'info');
      await loadState();
      return;
    }

    // Check if this group is assigned to another window
    if (selectedOption.dataset.assigned === 'true') {
      const assignedWindowId = parseInt(selectedOption.dataset.windowId, 10);
      showModal(selectedGroup, assignedWindowId);
      // Reset selection to current
      await loadState();
      return;
    }

    // Assign directly
    await assignGroup(selectedGroup);
  });

  // Modal: Re-assign
  modalReassign.addEventListener('click', async () => {
    if (pendingSelection) {
      await assignGroup(pendingSelection.groupName);
    }
    hideModal();
  });

  // Modal: Go to window
  modalGoto.addEventListener('click', async () => {
    if (pendingSelection) {
      await sendMessage({
        action: 'identifyWindow',
        windowId: pendingSelection.windowId
      });
    }
    hideModal();
    window.close();
  });

  // Modal: Cancel
  modalCancel.addEventListener('click', () => {
    hideModal();
  });

  // Click backdrop to cancel
  reassignModal.querySelector('.modal-backdrop').addEventListener('click', () => {
    hideModal();
  });

  // Event: Sort all tabs
  sortAllBtn.addEventListener('click', async () => {
    sortAllBtn.disabled = true;
    sortAllBtn.innerHTML = '<span>&#x21bb;</span> ...';

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
      sortAllBtn.innerHTML = '<span>&#x21bb;</span> Sort All';
    }
  });

  // Event: Label window with tab group
  labelWindowBtn.addEventListener('click', async () => {
    const currentWindow = await sendMessage({ action: 'getCurrentWindow' });

    if (!currentWindow.groupName) {
      showStatus('Assign a group first', 'error');
      return;
    }

    labelWindowBtn.disabled = true;
    try {
      const result = await sendMessage({ action: 'labelWindow', windowId: currentWindow.windowId });
      if (result.success) {
        showStatus(`Labeled as "${currentWindow.groupName}"`, 'success');
      } else {
        showStatus(result.error || 'Failed to label', 'error');
      }
    } catch (e) {
      showStatus('Error labeling window', 'error');
    } finally {
      labelWindowBtn.disabled = false;
    }
  });

  // Event: Open options
  optionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Initial load
  await loadState();
});
