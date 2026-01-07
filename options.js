// Tab Shepherd - Options Page Script

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const enableToggle = document.getElementById('enableToggle');
  const groupsTableBody = document.getElementById('groupsTableBody');
  const addGroupBtn = document.getElementById('addGroupBtn');
  const refreshWindowsBtn = document.getElementById('refreshWindowsBtn');
  const catchAllSelect = document.getElementById('catchAllSelect');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const statusDiv = document.getElementById('status');

  // Modal elements
  const groupModal = document.getElementById('groupModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const groupNameInput = document.getElementById('groupNameInput');
  const groupPatternsInput = document.getElementById('groupPatternsInput');
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  const modalSaveBtn = document.getElementById('modalSaveBtn');

  let currentConfig = null;
  let windowsList = [];
  let editingGroupIndex = null;
  let draggedRow = null;

  // ============================================================================
  // Helpers
  // ============================================================================

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  }

  function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }

  async function saveConfig() {
    await sendMessage({ action: 'saveConfig', config: currentConfig });
  }

  async function refreshWindows() {
    windowsList = await sendMessage({ action: 'getAllWindows' });
    renderGroupsTable();
  }

  function truncate(str, maxLen = 35) {
    if (!str || str === '(empty)' || str === '(no tabs)') return str;
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + '...';
  }

  function getWindowLabel(w) {
    // Priority order:
    // 1. Tab group name (if any tab is in a named group)
    // 2. First tab's title
    // 3. Window ID as fallback
    // Note: Chrome doesn't expose user-defined window names to extensions

    let name;
    if (w.tabGroupName) {
      name = w.tabGroupName;
    } else if (w.firstTabTitle && w.firstTabTitle !== '(no tabs)') {
      name = w.firstTabTitle;
    } else {
      name = `Window ${w.id}`;
    }

    return `${truncate(name)} (${w.tabCount} tabs)`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================================================
  // Render Functions
  // ============================================================================

  function renderGroupsTable() {
    if (currentConfig.groups.length === 0) {
      groupsTableBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="4">No groups configured yet. Add your first group!</td>
        </tr>
      `;
      return;
    }

    // Sort by priority
    const sortedGroups = [...currentConfig.groups].sort((a, b) => a.priority - b.priority);

    // Build window options HTML
    const windowOptionsHtml = windowsList.map(w => {
      return `<option value="${w.id}">${escapeHtml(getWindowLabel(w))}</option>`;
    }).join('');

    groupsTableBody.innerHTML = sortedGroups.map((group) => {
      // Find which window is bound to this group
      const boundWindow = windowsList.find(w => w.boundGroup === group.name);
      const boundWindowId = boundWindow ? boundWindow.id : '';

      return `
        <tr draggable="true" data-name="${escapeHtml(group.name)}">
          <td class="col-drag">
            <span class="drag-handle">&#x2630;</span>
          </td>
          <td class="col-group">
            <div class="group-info">
              <div class="group-name" data-name="${escapeHtml(group.name)}">${escapeHtml(group.name)}</div>
              <div class="group-patterns">${escapeHtml(group.patterns.join(' | '))}</div>
            </div>
          </td>
          <td class="col-window">
            <select class="window-select" data-group="${escapeHtml(group.name)}">
              <option value="">(not assigned)</option>
              ${windowOptionsHtml}
            </select>
          </td>
          <td class="col-actions">
            <div class="group-actions">
              <button class="btn-icon edit" data-name="${escapeHtml(group.name)}" title="Edit">&#x270E;</button>
              <button class="btn-icon delete" data-name="${escapeHtml(group.name)}" title="Delete">&#x2715;</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Set selected values for window dropdowns
    groupsTableBody.querySelectorAll('.window-select').forEach(select => {
      const groupName = select.dataset.group;
      const boundWindow = windowsList.find(w => w.boundGroup === groupName);
      if (boundWindow) {
        select.value = boundWindow.id;
      }
    });

    // Add event handlers
    setupTableEventHandlers();
  }

  function setupTableEventHandlers() {
    // Drag and drop
    const rows = groupsTableBody.querySelectorAll('tr[draggable="true"]');
    rows.forEach(row => {
      row.addEventListener('dragstart', handleDragStart);
      row.addEventListener('dragend', handleDragEnd);
      row.addEventListener('dragover', handleDragOver);
      row.addEventListener('dragleave', handleDragLeave);
      row.addEventListener('drop', handleDrop);
    });

    // Edit group (click on name)
    groupsTableBody.querySelectorAll('.group-name').forEach(el => {
      el.addEventListener('click', () => openEditModal(el.dataset.name));
    });

    // Edit button
    groupsTableBody.querySelectorAll('.btn-icon.edit').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(btn.dataset.name));
    });

    // Delete button
    groupsTableBody.querySelectorAll('.btn-icon.delete').forEach(btn => {
      btn.addEventListener('click', () => deleteGroup(btn.dataset.name));
    });

    // Window select change
    groupsTableBody.querySelectorAll('.window-select').forEach(select => {
      select.addEventListener('change', async () => {
        const groupName = select.dataset.group;
        const windowId = select.value ? parseInt(select.value) : null;

        await sendMessage({
          action: 'bindWindowToGroup',
          groupName: groupName,
          windowId: windowId
        });

        // Refresh to update other dropdowns
        await refreshWindows();
        showStatus(`Window ${windowId ? 'assigned to' : 'unassigned from'} "${groupName}"`, 'success');
      });
    });
  }

  function renderCatchAllSelect() {
    catchAllSelect.innerHTML = '<option value="">(none - leave unmatched tabs)</option>';

    for (const w of windowsList) {
      const option = document.createElement('option');
      option.value = w.id;
      option.textContent = getWindowLabel(w);
      if (currentConfig.catchAllWindowId === w.id) {
        option.selected = true;
      }
      catchAllSelect.appendChild(option);
    }
  }

  // ============================================================================
  // Drag and Drop
  // ============================================================================

  function handleDragStart(e) {
    draggedRow = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragEnd() {
    this.classList.remove('dragging');
    groupsTableBody.querySelectorAll('tr').forEach(row => {
      row.classList.remove('drag-over');
    });
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this !== draggedRow) {
      this.classList.add('drag-over');
    }
  }

  function handleDragLeave() {
    this.classList.remove('drag-over');
  }

  async function handleDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');

    if (draggedRow === this) return;

    const draggedName = draggedRow.dataset.name;
    const targetName = this.dataset.name;

    const draggedGroup = currentConfig.groups.find(g => g.name === draggedName);
    const targetGroup = currentConfig.groups.find(g => g.name === targetName);

    if (!draggedGroup || !targetGroup) return;

    // Swap priorities
    const temp = draggedGroup.priority;
    draggedGroup.priority = targetGroup.priority;
    targetGroup.priority = temp;

    // Normalize priorities
    const sorted = [...currentConfig.groups].sort((a, b) => a.priority - b.priority);
    sorted.forEach((g, i) => g.priority = i);

    await saveConfig();
    renderGroupsTable();
    showStatus('Priority updated', 'success');
  }

  // ============================================================================
  // Modal Functions
  // ============================================================================

  function openAddModal() {
    editingGroupIndex = null;
    modalTitle.textContent = 'Add Group';
    groupNameInput.value = '';
    groupPatternsInput.value = '';
    groupModal.style.display = 'flex';
    groupNameInput.focus();
  }

  function openEditModal(groupName) {
    const group = currentConfig.groups.find(g => g.name === groupName);
    if (!group) return;

    editingGroupIndex = currentConfig.groups.indexOf(group);
    modalTitle.textContent = 'Edit Group';
    groupNameInput.value = group.name;
    groupPatternsInput.value = group.patterns.join('\n');
    groupModal.style.display = 'flex';
    groupNameInput.focus();
  }

  function closeModal() {
    groupModal.style.display = 'none';
    editingGroupIndex = null;
  }

  async function saveModal() {
    const name = groupNameInput.value.trim();
    const patterns = groupPatternsInput.value
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (!name) {
      showStatus('Please enter a group name', 'error');
      return;
    }

    if (patterns.length === 0) {
      showStatus('Please enter at least one pattern', 'error');
      return;
    }

    // Validate patterns are valid regex
    for (const pattern of patterns) {
      try {
        new RegExp(pattern);
      } catch (e) {
        showStatus(`Invalid regex: ${pattern}`, 'error');
        return;
      }
    }

    if (editingGroupIndex !== null) {
      // Editing existing group
      const oldName = currentConfig.groups[editingGroupIndex].name;
      currentConfig.groups[editingGroupIndex].name = name;
      currentConfig.groups[editingGroupIndex].patterns = patterns;

      // Update catch-all if it was this group
      if (currentConfig.catchAllGroupName === oldName) {
        currentConfig.catchAllGroupName = name;
      }
    } else {
      // Check for duplicate name
      if (currentConfig.groups.some(g => g.name === name)) {
        showStatus('A group with this name already exists', 'error');
        return;
      }

      // Adding new group
      const maxPriority = Math.max(-1, ...currentConfig.groups.map(g => g.priority));
      currentConfig.groups.push({
        name,
        patterns,
        priority: maxPriority + 1
      });
    }

    await saveConfig();
    closeModal();
    await refreshWindows();
    renderCatchAllSelect();
    showStatus(editingGroupIndex !== null ? 'Group updated' : 'Group added', 'success');
  }

  async function deleteGroup(groupName) {
    if (!confirm(`Delete group "${groupName}"?`)) return;

    currentConfig.groups = currentConfig.groups.filter(g => g.name !== groupName);

    // Clear catch-all if it was this group
    if (currentConfig.catchAllGroupName === groupName) {
      currentConfig.catchAllGroupName = null;
    }

    // Re-normalize priorities
    const sorted = [...currentConfig.groups].sort((a, b) => a.priority - b.priority);
    sorted.forEach((g, i) => g.priority = i);

    await saveConfig();
    await refreshWindows();
    renderCatchAllSelect();
    showStatus('Group deleted', 'success');
  }

  // ============================================================================
  // Import / Export
  // ============================================================================

  function exportConfig() {
    const data = JSON.stringify(currentConfig, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'tab-shepherd-config.json';
    a.click();

    URL.revokeObjectURL(url);
    showStatus('Config exported', 'success');
  }

  async function importConfig(file) {
    try {
      const text = await file.text();
      const imported = JSON.parse(text);

      // Validate structure
      if (!imported.groups || !Array.isArray(imported.groups)) {
        throw new Error('Invalid config: missing groups array');
      }

      for (const group of imported.groups) {
        if (!group.name || !Array.isArray(group.patterns)) {
          throw new Error('Invalid config: group missing name or patterns');
        }
      }

      // Merge with defaults
      currentConfig = {
        enabled: imported.enabled !== false,
        groups: imported.groups.map((g, i) => ({
          name: g.name,
          patterns: g.patterns,
          priority: g.priority ?? i
        })),
        catchAllWindowId: imported.catchAllWindowId || null
      };

      await saveConfig();
      await refreshWindows();
      renderCatchAllSelect();
      showStatus('Config imported', 'success');
    } catch (e) {
      showStatus(`Import failed: ${e.message}`, 'error');
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  enableToggle.addEventListener('change', async () => {
    currentConfig.enabled = enableToggle.checked;
    await saveConfig();
    showStatus(currentConfig.enabled ? 'Tab Shepherd enabled' : 'Tab Shepherd disabled', 'info');
  });

  addGroupBtn.addEventListener('click', openAddModal);

  refreshWindowsBtn.addEventListener('click', async () => {
    await refreshWindows();
    showStatus('Windows refreshed', 'success');
  });

  catchAllSelect.addEventListener('change', async () => {
    currentConfig.catchAllWindowId = catchAllSelect.value ? parseInt(catchAllSelect.value) : null;
    await saveConfig();
    showStatus('Catch-all updated', 'success');
  });

  exportBtn.addEventListener('click', exportConfig);

  importBtn.addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importConfig(e.target.files[0]);
      e.target.value = ''; // Reset for re-import
    }
  });

  // Modal handlers
  modalCloseBtn.addEventListener('click', closeModal);
  modalCancelBtn.addEventListener('click', closeModal);
  modalSaveBtn.addEventListener('click', saveModal);

  groupModal.addEventListener('click', (e) => {
    if (e.target === groupModal) closeModal();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && groupModal.style.display !== 'none') {
      closeModal();
    }
    if (e.key === 'Enter' && e.ctrlKey && groupModal.style.display !== 'none') {
      saveModal();
    }
  });

  // ============================================================================
  // Initial Load
  // ============================================================================

  currentConfig = await sendMessage({ action: 'getConfig' });
  enableToggle.checked = currentConfig.enabled;
  await refreshWindows();
  renderCatchAllSelect();
});
