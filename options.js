// Tab Shepherd - Options Page Script

// Template definitions
const TEMPLATES = {
  development: {
    name: 'Development',
    icon: '&#x1F4BB;',
    patterns: ['localhost', '127.0.0.1'],
    mode: 'simple'
  },
  github: {
    name: 'GitHub',
    icon: '&#x1F419;',
    patterns: ['github.com'],
    mode: 'simple'
  },
  google: {
    name: 'Google Workspace',
    icon: '&#x1F4DD;',
    patterns: ['docs.google.com', 'sheets.google.com', 'drive.google.com', 'mail.google.com'],
    mode: 'simple'
  },
  productivity: {
    name: 'Productivity',
    icon: '&#x1F4CB;',
    patterns: ['notion.so', 'linear.app', 'slack.com', 'figma.com'],
    mode: 'simple'
  },
  social: {
    name: 'Social',
    icon: '&#x1F310;',
    patterns: ['twitter.com', 'x.com', 'linkedin.com', 'reddit.com'],
    mode: 'simple'
  },
  entertainment: {
    name: 'Entertainment',
    icon: '&#x1F3AC;',
    patterns: ['youtube.com', 'netflix.com', 'spotify.com'],
    mode: 'simple'
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const enableToggle = document.getElementById('enableToggle');
  const groupsTableBody = document.getElementById('groupsTableBody');
  const addGroupBtn = document.getElementById('addGroupBtn');
  const addFromTemplateBtn = document.getElementById('addFromTemplateBtn');
  const refreshWindowsBtn = document.getElementById('refreshWindowsBtn');
  const catchAllSelect = document.getElementById('catchAllSelect');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const statusDiv = document.getElementById('status');

  // Quick Start elements
  const quickStartSection = document.getElementById('quickStartSection');
  const groupsSection = document.getElementById('groupsSection');
  const addTemplatesBtn = document.getElementById('addTemplatesBtn');
  const skipTemplatesLink = document.getElementById('skipTemplatesLink');

  // Modal elements
  const groupModal = document.getElementById('groupModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const groupNameInput = document.getElementById('groupNameInput');
  const groupPatternsInput = document.getElementById('groupPatternsInput');
  const matchModeInput = document.getElementById('matchModeInput');
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  const modalSaveBtn = document.getElementById('modalSaveBtn');
  const modeButtons = document.querySelectorAll('.mode-btn');
  const simpleTips = document.getElementById('simpleTips');
  const regexTips = document.getElementById('regexTips');
  const testerResults = document.getElementById('testerResults');
  const matchCount = document.getElementById('matchCount');

  // Template modal elements
  const templateModal = document.getElementById('templateModal');
  const templateModalCloseBtn = document.getElementById('templateModalCloseBtn');
  const templateModalCancelBtn = document.getElementById('templateModalCancelBtn');
  const templateModalAddBtn = document.getElementById('templateModalAddBtn');
  const templateList = document.getElementById('templateList');

  let currentConfig = null;
  let windowsList = [];
  let editingGroupIndex = null;
  let draggedRow = null;
  let patternTestDebounce = null;

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
    renderCatchAllSelect();
  }

  function truncate(str, maxLen = 35) {
    if (!str || str === '(empty)' || str === '(no tabs)') return str;
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + '...';
  }

  function getWindowLabel(w) {
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
  // Quick Start / Onboarding
  // ============================================================================

  function checkShowQuickStart() {
    if (currentConfig.groups.length === 0) {
      quickStartSection.style.display = 'block';
      groupsSection.style.display = 'none';
    } else {
      quickStartSection.style.display = 'none';
      groupsSection.style.display = 'block';
    }
  }

  async function addTemplates(templateIds) {
    let added = 0;
    for (const id of templateIds) {
      const template = TEMPLATES[id];
      if (!template) continue;

      // Skip if group with same name exists
      if (currentConfig.groups.some(g => g.name.toLowerCase() === template.name.toLowerCase())) {
        continue;
      }

      const maxPriority = Math.max(-1, ...currentConfig.groups.map(g => g.priority));
      currentConfig.groups.push({
        name: template.name,
        patterns: template.patterns,
        mode: template.mode || 'simple',
        priority: maxPriority + 1
      });
      added++;
    }

    if (added > 0) {
      await saveConfig();
      await refreshWindows();
      checkShowQuickStart();
      showStatus(`Added ${added} group${added > 1 ? 's' : ''}`, 'success');
    }
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

    const sortedGroups = [...currentConfig.groups].sort((a, b) => a.priority - b.priority);

    groupsTableBody.innerHTML = sortedGroups.map((group) => {
      const boundWindow = windowsList.find(w => w.boundGroup === group.name);
      const modeLabel = group.mode === 'regex' ? ' <span style="font-size:10px;color:#888;">(regex)</span>' : '';

      // Build window options
      const windowOptions = windowsList.map(w => {
        const selected = boundWindow && boundWindow.id === w.id ? 'selected' : '';
        return `<option value="${w.id}" ${selected}>${escapeHtml(getWindowLabel(w))}</option>`;
      }).join('');

      return `
        <tr draggable="true" data-name="${escapeHtml(group.name)}">
          <td class="col-drag">
            <span class="drag-handle">&#x2630;</span>
          </td>
          <td class="col-group">
            <div class="group-info">
              <div class="group-name" data-name="${escapeHtml(group.name)}">${escapeHtml(group.name)}${modeLabel}</div>
              <div class="group-patterns">${escapeHtml(group.patterns.join(' | '))}</div>
            </div>
          </td>
          <td class="col-window">
            <div class="window-select-wrapper">
              <select class="window-select" data-group="${escapeHtml(group.name)}">
                <option value="">(not assigned)</option>
                ${windowOptions}
              </select>
              <button class="btn-identify" data-group="${escapeHtml(group.name)}" title="Identify window">&#x1F441;</button>
            </div>
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

        await refreshWindows();
        showStatus(`Window ${windowId ? 'assigned to' : 'unassigned from'} "${groupName}"`, 'success');
      });
    });

    // Identify window button
    groupsTableBody.querySelectorAll('.btn-identify').forEach(btn => {
      btn.addEventListener('click', async () => {
        const groupName = btn.dataset.group;
        const select = btn.parentElement.querySelector('.window-select');
        const windowId = select.value ? parseInt(select.value) : null;

        if (!windowId) {
          showStatus('No window assigned to identify', 'info');
          return;
        }

        await sendMessage({ action: 'identifyWindow', windowId });
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
  // Pattern Tester
  // ============================================================================

  async function testPatterns() {
    const patterns = groupPatternsInput.value
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (patterns.length === 0) {
      testerResults.innerHTML = '<p class="tester-hint">Enter patterns to see which tabs would match.</p>';
      matchCount.textContent = '0 matches';
      matchCount.classList.add('no-match');
      return;
    }

    const isSimpleMode = matchModeInput.value === 'simple';

    const tabs = await sendMessage({
      action: 'testPatterns',
      patterns,
      simpleMode: isSimpleMode
    });

    const matches = tabs.filter(t => t.matches);
    const nonMatches = tabs.filter(t => !t.matches);

    matchCount.textContent = `${matches.length} match${matches.length !== 1 ? 'es' : ''}`;
    matchCount.classList.toggle('no-match', matches.length === 0);

    // Show matches first, then non-matches
    const sortedTabs = [...matches, ...nonMatches].slice(0, 20); // Limit to 20 tabs

    if (sortedTabs.length === 0) {
      testerResults.innerHTML = '<p class="tester-hint">No open tabs to test against.</p>';
      return;
    }

    testerResults.innerHTML = sortedTabs.map(tab => `
      <div class="tester-item ${tab.matches ? 'match' : 'no-match'}">
        <span class="tester-icon">${tab.matches ? '&#x2714;' : '&#x2718;'}</span>
        <div class="tester-info">
          <div class="tester-title">${escapeHtml(truncate(tab.title, 40))}</div>
          <div class="tester-url">${escapeHtml(truncate(tab.url.replace(/^https?:\/\//, ''), 50))}</div>
        </div>
      </div>
    `).join('');
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

    const temp = draggedGroup.priority;
    draggedGroup.priority = targetGroup.priority;
    targetGroup.priority = temp;

    const sorted = [...currentConfig.groups].sort((a, b) => a.priority - b.priority);
    sorted.forEach((g, i) => g.priority = i);

    await saveConfig();
    renderGroupsTable();
    showStatus('Priority updated', 'success');
  }

  // ============================================================================
  // Modal Functions
  // ============================================================================

  function setMatchMode(mode) {
    matchModeInput.value = mode;
    modeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    simpleTips.style.display = mode === 'simple' ? 'block' : 'none';
    regexTips.style.display = mode === 'regex' ? 'block' : 'none';

    // Update placeholder
    if (mode === 'simple') {
      groupPatternsInput.placeholder = 'github.com\nlocalhost:3000\nmy-project';
    } else {
      groupPatternsInput.placeholder = 'github\\.com\nlocalhost:300[0-9]\n\\[ART-\\d+\\]';
    }

    // Re-test patterns
    testPatterns();
  }

  function openAddModal() {
    editingGroupIndex = null;
    modalTitle.textContent = 'Add Group';
    groupNameInput.value = '';
    groupPatternsInput.value = '';
    setMatchMode('simple');
    testerResults.innerHTML = '<p class="tester-hint">Enter patterns to see which tabs would match.</p>';
    matchCount.textContent = '0 matches';
    matchCount.classList.add('no-match');
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
    setMatchMode(group.mode || 'simple');
    groupModal.style.display = 'flex';
    groupNameInput.focus();

    // Test patterns after modal opens
    setTimeout(testPatterns, 100);
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
    const mode = matchModeInput.value;

    if (!name) {
      showStatus('Please enter a group name', 'error');
      return;
    }

    if (patterns.length === 0) {
      showStatus('Please enter at least one pattern', 'error');
      return;
    }

    // Validate regex patterns
    if (mode === 'regex') {
      for (const pattern of patterns) {
        try {
          new RegExp(pattern);
        } catch (e) {
          showStatus(`Invalid regex: ${pattern}`, 'error');
          return;
        }
      }
    }

    if (editingGroupIndex !== null) {
      const oldName = currentConfig.groups[editingGroupIndex].name;
      currentConfig.groups[editingGroupIndex].name = name;
      currentConfig.groups[editingGroupIndex].patterns = patterns;
      currentConfig.groups[editingGroupIndex].mode = mode;

      if (currentConfig.catchAllGroupName === oldName) {
        currentConfig.catchAllGroupName = name;
      }
    } else {
      if (currentConfig.groups.some(g => g.name === name)) {
        showStatus('A group with this name already exists', 'error');
        return;
      }

      const maxPriority = Math.max(-1, ...currentConfig.groups.map(g => g.priority));
      currentConfig.groups.push({
        name,
        patterns,
        mode,
        priority: maxPriority + 1
      });
    }

    await saveConfig();
    closeModal();
    await refreshWindows();
    checkShowQuickStart();
    showStatus(editingGroupIndex !== null ? 'Group updated' : 'Group added', 'success');
  }

  async function deleteGroup(groupName) {
    if (!confirm(`Delete group "${groupName}"?`)) return;

    currentConfig.groups = currentConfig.groups.filter(g => g.name !== groupName);

    if (currentConfig.catchAllGroupName === groupName) {
      currentConfig.catchAllGroupName = null;
    }

    const sorted = [...currentConfig.groups].sort((a, b) => a.priority - b.priority);
    sorted.forEach((g, i) => g.priority = i);

    await saveConfig();
    await refreshWindows();
    checkShowQuickStart();
    showStatus('Group deleted', 'success');
  }

  // ============================================================================
  // Template Modal
  // ============================================================================

  function openTemplateModal() {
    // Build template list excluding already-added templates
    const existingNames = currentConfig.groups.map(g => g.name.toLowerCase());

    templateList.innerHTML = Object.entries(TEMPLATES).map(([id, template]) => {
      const exists = existingNames.includes(template.name.toLowerCase());
      const disabledClass = exists ? 'style="opacity: 0.5; pointer-events: none;"' : '';

      return `
        <div class="template-list-item" data-id="${id}" ${disabledClass}>
          <span class="template-list-icon">${template.icon}</span>
          <div class="template-list-info">
            <div class="template-list-name">${template.name}${exists ? ' (already added)' : ''}</div>
            <div class="template-list-patterns">${template.patterns.join(', ')}</div>
          </div>
          <div class="template-check">&#x2714;</div>
        </div>
      `;
    }).join('');

    // Add click handlers
    templateList.querySelectorAll('.template-list-item:not([style])').forEach(item => {
      item.addEventListener('click', () => {
        item.classList.toggle('selected');
      });
    });

    templateModal.style.display = 'flex';
  }

  function closeTemplateModal() {
    templateModal.style.display = 'none';
  }

  async function addSelectedTemplates() {
    const selectedIds = Array.from(templateList.querySelectorAll('.template-list-item.selected'))
      .map(item => item.dataset.id);

    if (selectedIds.length === 0) {
      showStatus('Please select at least one template', 'error');
      return;
    }

    await addTemplates(selectedIds);
    closeTemplateModal();
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

      if (!imported.groups || !Array.isArray(imported.groups)) {
        throw new Error('Invalid config: missing groups array');
      }

      for (const group of imported.groups) {
        if (!group.name || !Array.isArray(group.patterns)) {
          throw new Error('Invalid config: group missing name or patterns');
        }
      }

      currentConfig = {
        enabled: imported.enabled !== false,
        groups: imported.groups.map((g, i) => ({
          name: g.name,
          patterns: g.patterns,
          mode: g.mode || 'simple',
          priority: g.priority ?? i
        })),
        catchAllWindowId: imported.catchAllWindowId || null
      };

      await saveConfig();
      await refreshWindows();
      checkShowQuickStart();
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

  addFromTemplateBtn.addEventListener('click', openTemplateModal);

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
      e.target.value = '';
    }
  });

  // Quick Start handlers
  addTemplatesBtn.addEventListener('click', async () => {
    const selectedTemplates = Array.from(quickStartSection.querySelectorAll('input[type="checkbox"]:checked'))
      .map(cb => cb.value);
    await addTemplates(selectedTemplates);
  });

  skipTemplatesLink.addEventListener('click', (e) => {
    e.preventDefault();
    quickStartSection.style.display = 'none';
    groupsSection.style.display = 'block';
  });

  // Modal handlers
  modalCloseBtn.addEventListener('click', closeModal);
  modalCancelBtn.addEventListener('click', closeModal);
  modalSaveBtn.addEventListener('click', saveModal);

  groupModal.addEventListener('click', (e) => {
    if (e.target === groupModal) closeModal();
  });

  // Mode toggle
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => setMatchMode(btn.dataset.mode));
  });

  // Pattern tester - debounced
  groupPatternsInput.addEventListener('input', () => {
    clearTimeout(patternTestDebounce);
    patternTestDebounce = setTimeout(testPatterns, 300);
  });

  // Template modal handlers
  templateModalCloseBtn.addEventListener('click', closeTemplateModal);
  templateModalCancelBtn.addEventListener('click', closeTemplateModal);
  templateModalAddBtn.addEventListener('click', addSelectedTemplates);

  templateModal.addEventListener('click', (e) => {
    if (e.target === templateModal) closeTemplateModal();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (groupModal.style.display !== 'none') closeModal();
      if (templateModal.style.display !== 'none') closeTemplateModal();
    }
    if (e.key === 'Enter' && e.ctrlKey && groupModal.style.display !== 'none') {
      saveModal();
    }
  });

  // ============================================================================
  // Initial Load
  // ============================================================================

  currentConfig = await sendMessage({ action: 'getConfig' });

  // Ensure groups have mode property
  currentConfig.groups = currentConfig.groups.map(g => ({
    ...g,
    mode: g.mode || 'simple'
  }));

  enableToggle.checked = currentConfig.enabled;
  await refreshWindows();
  checkShowQuickStart();
});
