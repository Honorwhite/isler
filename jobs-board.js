// Jasmin Digital - Site-Matched 3-Column Kanban Job Tracker
(function () {
    const COLUMNS = [
        {
            key: 'todo',
            label: 'Yapılacak',
            emptyText: 'Yapılacak iş yok',
            emptyHint: 'Yukarıdan yeni iş ekleyebilirsin',
            allowQuickAdd: true
        },
        {
            key: 'approval',
            label: 'Onayda',
            emptyText: 'Onay bekleyen iş yok',
            emptyHint: 'Kartı buraya sürükle veya gönder',
            allowQuickAdd: true
        },
        {
            key: 'done',
            label: 'Tamamlandı',
            emptyText: 'Henüz tamamlanan iş yok',
            emptyHint: 'Biten işler burada listelenir',
            allowQuickAdd: false
        }
    ];

    const LOCAL_APPROVAL_KEY = 'jasmin_jobs_approval_ids';
    const FULL_MONTHS_TR = [
        'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
        'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
    ];

    let allJobs = [];
    let searchQuery = '';
    let hasStatusColumn = null;
    let sortables = [];
    let activeAddColumn = null;
    let editingJobId = null;
    let quickAddTarget = 'todo';
    let mobileActiveCol = 'all'; // 'all' | 'todo' | 'approval' | 'done'
    const expandedDoneDays = new Set();
    const expandedDoneMonths = new Set();

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatShortDate(isoStr) {
        if (!isoStr) return '';
        const date = new Date(isoStr);
        if (isNaN(date.getTime())) return '';

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const diffDays = Math.round((todayStart - targetStart) / 86400000);

        if (diffDays === 0) return 'Bugün';
        if (diffDays === 1) return 'Dün';
        if (diffDays > 1 && diffDays < 7) return `${diffDays} gün önce`;

        const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
        return `${date.getDate()} ${months[date.getMonth()]}`;
    }

    function getLocalApprovalIds() {
        try {
            const raw = localStorage.getItem(LOCAL_APPROVAL_KEY);
            return new Set(raw ? JSON.parse(raw).map(String) : []);
        } catch {
            return new Set();
        }
    }

    function setLocalApprovalId(id, isApproval) {
        const set = getLocalApprovalIds();
        if (isApproval) set.add(String(id));
        else set.delete(String(id));
        try {
            localStorage.setItem(LOCAL_APPROVAL_KEY, JSON.stringify([...set]));
        } catch {
            // ignore
        }
    }

    function getJobStatus(job) {
        if (job.status && ['todo', 'approval', 'done'].includes(job.status)) {
            return job.status;
        }
        if (job.is_completed) return 'done';
        if (hasStatusColumn === false && getLocalApprovalIds().has(String(job.id))) {
            return 'approval';
        }
        return 'todo';
    }

    function isMissingStatusColumnError(error) {
        if (!error) return false;
        const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
        return error.code === '42703' || error.code === 'PGRST204' || msg.includes('status');
    }

    async function fetchJobs() {
        const container = document.getElementById('jobs-container');
        if (!container) return;

        const { data, error } = await sb.from('jobs').select('*');
        if (error) {
            console.error('İşler yüklenemedi:', error);
            return;
        }

        if (data && data.length > 0 && hasStatusColumn === null) {
            hasStatusColumn = Object.prototype.hasOwnProperty.call(data[0], 'status');
        }

        allJobs = data || [];
        renderBoard();
    }

    function getGroupedJobs() {
        const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
        const filtered = q
            ? allJobs.filter(j => (j.title || '').toLocaleLowerCase('tr-TR').includes(q))
            : allJobs;

        const groups = { todo: [], approval: [], done: [] };
        filtered.forEach(job => {
            groups[getJobStatus(job)].push(job);
        });

        groups.todo.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || new Date(a.created_at) - new Date(b.created_at));
        groups.approval.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || new Date(a.created_at) - new Date(b.created_at));
        groups.done.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

        return groups;
    }

    function renderBoard() {
        const container = document.getElementById('jobs-container');
        if (!container) return;

        // Preserve column scroll positions
        const scrollPositions = {};
        COLUMNS.forEach(col => {
            const listEl = document.getElementById(`kanban-list-${col.key}`);
            if (listEl) scrollPositions[col.key] = listEl.scrollTop;
        });

        const groups = getGroupedJobs();
        const isSearching = searchQuery.trim().length > 0;
        const activeCount = groups.todo.length + groups.approval.length;

        container.innerHTML = `
            <div class="kanban-top-panel">
                <form class="kanban-quickbar" onsubmit="event.preventDefault(); window.kanbanSubmitTopAdd();">
                    <div class="kanban-quickbar-input-wrap">
                        <i data-lucide="plus-circle"></i>
                        <input
                            type="text"
                            id="kanban-top-input"
                            placeholder="Yeni iş ekle..."
                            autocomplete="off"
                        />
                    </div>
                    <div class="kanban-quickbar-controls">
                        <div class="kanban-target-switch" role="group" aria-label="Hedef kolon">
                            <button type="button" class="kanban-target-btn ${quickAddTarget === 'todo' ? 'active is-todo' : ''}" onclick="window.kanbanSetQuickTarget('todo')">
                                <span class="k-dot dot-todo"></span> Yapılacak
                            </button>
                            <button type="button" class="kanban-target-btn ${quickAddTarget === 'approval' ? 'active is-approval' : ''}" onclick="window.kanbanSetQuickTarget('approval')">
                                <span class="k-dot dot-approval"></span> Onayda
                            </button>
                        </div>
                        <button type="submit" class="kanban-primary-btn">
                            <i data-lucide="plus"></i>
                            <span>Ekle</span>
                        </button>
                    </div>
                </form>

                <div class="kanban-subbar">
                    <div class="kanban-mobile-filters">
                        <button type="button" class="kanban-filter-pill ${mobileActiveCol === 'all' ? 'active' : ''}" onclick="window.kanbanSetMobileCol('all')">
                            Tümü <span class="pill-count">${activeCount + groups.done.length}</span>
                        </button>
                        <button type="button" class="kanban-filter-pill ${mobileActiveCol === 'todo' ? 'active' : ''}" onclick="window.kanbanSetMobileCol('todo')">
                            <span class="k-dot dot-todo"></span> Yapılacak <span class="pill-count">${groups.todo.length}</span>
                        </button>
                        <button type="button" class="kanban-filter-pill ${mobileActiveCol === 'approval' ? 'active' : ''}" onclick="window.kanbanSetMobileCol('approval')">
                            <span class="k-dot dot-approval"></span> Onayda <span class="pill-count">${groups.approval.length}</span>
                        </button>
                        <button type="button" class="kanban-filter-pill ${mobileActiveCol === 'done' ? 'active' : ''}" onclick="window.kanbanSetMobileCol('done')">
                            <span class="k-dot dot-done"></span> Biten <span class="pill-count">${groups.done.length}</span>
                        </button>
                    </div>

                    <div class="kanban-summary-text">
                        <span><strong>${activeCount}</strong> aktif iş</span>
                        <span class="summary-sep">·</span>
                        <span><strong>${groups.done.length}</strong> tamamlandı</span>
                    </div>

                    <div class="kanban-search">
                        <i data-lucide="search"></i>
                        <input
                            type="text"
                            id="kanban-search-input"
                            placeholder="İşlerde ara..."
                            value="${escapeHtml(searchQuery)}"
                            oninput="window.kanbanOnSearch(this.value)"
                        />
                        ${isSearching ? `<button type="button" class="kanban-search-clear" onclick="window.kanbanClearSearch()" title="Temizle"><i data-lucide="x"></i></button>` : ''}
                    </div>
                </div>
            </div>

            <div class="kanban-board mobile-filter-${mobileActiveCol}">
                ${COLUMNS.map(col => renderColumn(col, groups[col.key], isSearching)).join('')}
            </div>
        `;

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        if (activeAddColumn) {
            const addInput = document.getElementById(`kanban-add-input-${activeAddColumn}`);
            if (addInput) addInput.focus();
        }

        if (editingJobId) {
            const editInput = document.getElementById(`kanban-edit-input-${editingJobId}`);
            if (editInput) {
                editInput.focus();
                editInput.select();
            }
        }

        // Restore column scroll positions
        COLUMNS.forEach(col => {
            const listEl = document.getElementById(`kanban-list-${col.key}`);
            if (listEl && scrollPositions[col.key]) {
                listEl.scrollTop = scrollPositions[col.key];
            }
        });

        initSortables();
    }

    function toLocalDayKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function toLocalMonthKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    function formatDayGroupLabel(dayKey, todayKey, yesterdayKey) {
        const [y, m, d] = dayKey.split('-').map(Number);
        const base = `${d} ${FULL_MONTHS_TR[m - 1]}`;
        if (dayKey === todayKey) return `Bugün · ${base}`;
        if (dayKey === yesterdayKey) return `Dün · ${base}`;
        return base;
    }

    function formatMonthGroupLabel(monthKey, currentYear) {
        const [y, m] = monthKey.split('-').map(Number);
        const name = FULL_MONTHS_TR[m - 1];
        return y === currentYear ? `${name} Ayı` : `${name} ${y}`;
    }

    function renderDoneDayBlock(dayKey, dayJobs, todayKey, yesterdayKey, isSearching) {
        const isOpen = isSearching || expandedDoneDays.has(dayKey);
        const label = formatDayGroupLabel(dayKey, todayKey, yesterdayKey);
        return `
            <div class="done-group done-day-group ${isOpen ? 'is-open' : ''}">
                <button type="button" class="done-group-header done-day-header" onclick="window.kanbanToggleDoneDay('${dayKey}')">
                    <span class="done-group-left">
                        <i data-lucide="chevron-right" class="done-chevron"></i>
                        <span class="done-group-label">${label}</span>
                    </span>
                    <span class="done-group-count">${dayJobs.length} iş</span>
                </button>
                ${isOpen ? `
                    <div class="done-day-items">
                        ${dayJobs.map(job => renderCard(job, 'done')).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderDoneGrouped(items, isSearching) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonthKey = toLocalMonthKey(now);
        const todayKey = toLocalDayKey(now);
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const yesterdayKey = toLocalDayKey(yesterday);

        // Group by month -> day
        const monthsMap = new Map();
        items.forEach(job => {
            const rawDate = new Date(job.updated_at || job.created_at || Date.now());
            const d = isNaN(rawDate.getTime()) ? now : rawDate;
            const mKey = toLocalMonthKey(d);
            const dKey = toLocalDayKey(d);

            if (!monthsMap.has(mKey)) monthsMap.set(mKey, new Map());
            const daysMap = monthsMap.get(mKey);
            if (!daysMap.has(dKey)) daysMap.set(dKey, []);
            daysMap.get(dKey).push(job);
        });

        // Sort months newest -> oldest
        const sortedMonthKeys = Array.from(monthsMap.keys()).sort((a, b) => b.localeCompare(a));
        let html = '';

        // 1. Current month: show days directly
        if (monthsMap.has(currentMonthKey)) {
            const currentDaysMap = monthsMap.get(currentMonthKey);
            const sortedDays = Array.from(currentDaysMap.keys()).sort((a, b) => b.localeCompare(a));
            html += sortedDays
                .map(dKey => renderDoneDayBlock(dKey, currentDaysMap.get(dKey), todayKey, yesterdayKey, isSearching))
                .join('');
        }

        // 2. Previous months: collapsible month -> collapsible days -> cards
        const pastMonths = sortedMonthKeys.filter(mKey => mKey !== currentMonthKey);
        if (pastMonths.length > 0) {
            if (monthsMap.has(currentMonthKey)) {
                html += `<div class="done-section-divider"><span>Önceki Aylar</span></div>`;
            }

            html += pastMonths.map(mKey => {
                const daysMap = monthsMap.get(mKey);
                const sortedDays = Array.from(daysMap.keys()).sort((a, b) => b.localeCompare(a));
                const monthTotal = sortedDays.reduce((sum, dk) => sum + daysMap.get(dk).length, 0);
                const isMonthOpen = isSearching || expandedDoneMonths.has(mKey);
                const monthLabel = formatMonthGroupLabel(mKey, currentYear);

                return `
                    <div class="done-group done-month-group ${isMonthOpen ? 'is-open' : ''}">
                        <button type="button" class="done-group-header done-month-header" onclick="window.kanbanToggleDoneMonth('${mKey}')">
                            <span class="done-group-left">
                                <i data-lucide="chevron-right" class="done-chevron"></i>
                                <i data-lucide="calendar" class="done-month-icon"></i>
                                <span class="done-group-label">${monthLabel}</span>
                            </span>
                            <span class="done-group-count">${monthTotal} iş</span>
                        </button>
                        ${isMonthOpen ? `
                            <div class="done-month-days">
                                ${sortedDays.map(dKey => renderDoneDayBlock(dKey, daysMap.get(dKey), todayKey, yesterdayKey, isSearching)).join('')}
                            </div>
                        ` : ''}
                    </div>
                `;
            }).join('');
        }

        return html;
    }

    function renderColumn(col, items, isSearching) {
        const totalCount = items.length;
        const isAddingHere = activeAddColumn === col.key;

        let listContent = '';
        if (items.length === 0) {
            listContent = `
                <div class="kanban-empty-state">
                    <p>${isSearching ? 'Eşleşen iş bulunamadı' : col.emptyText}</p>
                    ${!isSearching ? `<span>${col.emptyHint}</span>` : ''}
                </div>
            `;
        } else if (col.key === 'done') {
            listContent = renderDoneGrouped(items, isSearching);
        } else {
            listContent = items.map(job => renderCard(job, col.key)).join('');
        }

        return `
            <div class="kanban-col col-${col.key}" data-col="${col.key}">
                <div class="kanban-col-header">
                    <div class="kanban-col-title-wrap">
                        <span class="k-dot dot-${col.key}"></span>
                        <h3 class="kanban-col-title">${col.label}</h3>
                    </div>
                    <span class="kanban-col-count" id="count-${col.key}">${totalCount}</span>
                </div>

                <div class="kanban-list" id="kanban-list-${col.key}" data-status="${col.key}">
                    ${listContent}
                </div>

                ${col.allowQuickAdd ? (
                isAddingHere ? `
                        <form class="kanban-inline-form" onsubmit="event.preventDefault(); window.kanbanSubmitQuickAdd('${col.key}');">
                            <input
                                type="text"
                                id="kanban-add-input-${col.key}"
                                class="kanban-inline-input"
                                placeholder="İş adını yazıp Enter'a bas..."
                                onkeydown="if(event.key==='Escape'){window.kanbanCancelQuickAdd();}"
                                autocomplete="off"
                            />
                            <div class="kanban-inline-actions">
                                <button type="submit" class="kanban-inline-save">Ekle</button>
                                <button type="button" class="kanban-inline-cancel" onclick="window.kanbanCancelQuickAdd()">Vazgeç</button>
                            </div>
                        </form>
                    ` : `
                        <button type="button" class="kanban-add-btn" onclick="window.kanbanOpenQuickAdd('${col.key}')">
                            <i data-lucide="plus"></i>
                            <span>Bu sütuna ekle</span>
                        </button>
                    `
            ) : ''}
            </div>
        `;
    }

    function renderCard(job, status) {
        const safeId = escapeHtml(job.id);
        const safeTitle = escapeHtml(job.title);
        const dateLabel = formatShortDate(status === 'done' ? (job.updated_at || job.created_at) : job.created_at);

        if (String(editingJobId) === String(job.id)) {
            return `
                <div class="kanban-card is-editing" data-id="${safeId}">
                    <form class="kanban-edit-form" onsubmit="event.preventDefault(); window.kanbanSaveEdit('${safeId}');">
                        <input
                            type="text"
                            id="kanban-edit-input-${safeId}"
                            class="kanban-inline-input"
                            value="${safeTitle}"
                            onkeydown="if(event.key==='Escape'){window.kanbanCancelEdit();}"
                            autocomplete="off"
                        />
                        <div class="kanban-inline-actions">
                            <button type="submit" class="kanban-inline-save">Kaydet</button>
                            <button type="button" class="kanban-inline-cancel" onclick="window.kanbanCancelEdit()">İptal</button>
                        </div>
                    </form>
                </div>
            `;
        }

        let primaryMoveButtons = '';
        if (status === 'todo') {
            primaryMoveButtons = `
                <button type="button" class="kanban-card-btn btn-move-approval" title="Onaya gönder" onclick="event.stopPropagation(); window.kanbanMoveJob('${safeId}', 'approval')">
                    <i data-lucide="arrow-right"></i>
                </button>
                <button type="button" class="kanban-card-btn btn-move-done" title="Tamamlandı olarak işaretle" onclick="event.stopPropagation(); window.kanbanMoveJob('${safeId}', 'done')">
                    <i data-lucide="check"></i>
                </button>
            `;
        } else if (status === 'approval') {
            primaryMoveButtons = `
                <button type="button" class="kanban-card-btn btn-move-todo" title="Yapılacaklara geri al" onclick="event.stopPropagation(); window.kanbanMoveJob('${safeId}', 'todo')">
                    <i data-lucide="arrow-left"></i>
                </button>
                <button type="button" class="kanban-card-btn btn-move-done" title="Onayla ve Tamamla" onclick="event.stopPropagation(); window.kanbanMoveJob('${safeId}', 'done')">
                    <i data-lucide="check"></i>
                </button>
            `;
        } else {
            primaryMoveButtons = `
                <button type="button" class="kanban-card-btn btn-move-todo" title="Yapılacaklara geri al" onclick="event.stopPropagation(); window.kanbanMoveJob('${safeId}', 'todo')">
                    <i data-lucide="rotate-ccw"></i>
                </button>
            `;
        }

        return `
            <div class="kanban-card card-${status}" data-id="${safeId}" ondblclick="window.kanbanStartEdit('${safeId}')">
                <div class="kanban-card-main">
                    <div class="kanban-card-grip" title="Sürükle">
                        <i data-lucide="grip-vertical"></i>
                    </div>
                    <div class="kanban-card-body">
                        <div class="kanban-card-title">${safeTitle}</div>
                        ${dateLabel ? `<div class="kanban-card-meta">${dateLabel}</div>` : ''}
                    </div>
                </div>
                <div class="kanban-card-actions">
                    ${primaryMoveButtons}
                    <button type="button" class="kanban-card-btn" title="Düzenle" onclick="event.stopPropagation(); window.kanbanStartEdit('${safeId}')">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button type="button" class="kanban-card-btn btn-danger" title="Sil" onclick="event.stopPropagation(); window.kanbanDeleteJob('${safeId}')">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
        `;
    }

    function initSortables() {
        sortables.forEach(s => s.destroy());
        sortables = [];

        if (typeof Sortable === 'undefined') return;

        COLUMNS.forEach(col => {
            const listEl = document.getElementById(`kanban-list-${col.key}`);
            if (!listEl) return;

            const instance = new Sortable(listEl, {
                group: 'kanban-jobs',
                animation: 150,
                swapThreshold: 0.65,
                ghostClass: 'kanban-ghost',
                chosenClass: 'kanban-chosen',
                dragClass: 'kanban-drag',
                filter: '.is-editing, .kanban-empty-state, .done-group, .done-section-divider, button, input',
                preventOnFilter: false,
                onEnd: function (evt) {
                    const jobId = evt.item.dataset.id;
                    const targetStatus = evt.to.dataset.status;
                    const sourceStatus = evt.from.dataset.status;

                    if (!jobId || !targetStatus) return;
                    if (sourceStatus === targetStatus && evt.oldIndex === evt.newIndex) return;

                    const statusChanged = sourceStatus !== targetStatus;
                    const now = new Date().toISOString();

                    const targetIds = Array.from(evt.to.querySelectorAll('.kanban-card'))
                        .map(el => el.dataset.id)
                        .filter(Boolean);

                    // Track only cards whose position actually changed
                    const changedPositions = [];
                    targetIds.forEach((id, idx) => {
                        const j = allJobs.find(item => String(item.id) === String(id));
                        if (!j) return;
                        if (j.position !== idx) {
                            j.position = idx;
                            if (String(id) !== String(jobId) || !statusChanged) {
                                changedPositions.push({ id, position: idx });
                            }
                        }
                    });

                    const movedJob = allJobs.find(j => String(j.id) === String(jobId));
                    if (movedJob) {
                        movedJob.status = targetStatus;
                        movedJob.is_completed = targetStatus === 'done';
                        movedJob.updated_at = now;
                        if (hasStatusColumn === false) {
                            setLocalApprovalId(jobId, targetStatus === 'approval');
                        }
                    }

                    // Instant optimistic UI update (0ms lag)
                    renderBoard();

                    // Persist to Supabase silently in background
                    persistStatusAndOrder(jobId, targetStatus, targetIds, changedPositions, statusChanged, now);
                }
            });

            sortables.push(instance);
        });
    }

    function updateColumnCounts() {
        const groups = getGroupedJobs();
        COLUMNS.forEach(col => {
            const el = document.getElementById(`count-${col.key}`);
            if (el) el.textContent = groups[col.key].length;
        });
    }

    async function updateJobInDb(id, payload) {
        let res = await sb.from('jobs').update(payload).eq('id', id);
        if (res.error && isMissingStatusColumnError(res.error) && 'status' in payload) {
            hasStatusColumn = false;
            const { status, ...fallbackPayload } = payload;
            setLocalApprovalId(id, status === 'approval');
            res = await sb.from('jobs').update(fallbackPayload).eq('id', id);
        } else if (!res.error && 'status' in payload) {
            hasStatusColumn = true;
            setLocalApprovalId(id, payload.status === 'approval');
        }
        return res;
    }

    async function insertJobInDb(title, colKey) {
        const groups = getGroupedJobs();
        const colItems = groups[colKey] || [];
        const maxPos = colItems.reduce((max, item) => Math.max(max, item.position || 0), -1);

        const row = {
            title,
            is_completed: colKey === 'done',
            status: colKey,
            position: maxPos + 1
        };

        let res = await sb.from('jobs').insert([row]).select();
        if (res.error && isMissingStatusColumnError(res.error)) {
            hasStatusColumn = false;
            const { status, ...fallbackRow } = row;
            res = await sb.from('jobs').insert([fallbackRow]).select();
            if (!res.error && res.data && res.data[0] && colKey === 'approval') {
                setLocalApprovalId(res.data[0].id, true);
            }
        } else if (!res.error) {
            hasStatusColumn = true;
        }
        return res;
    }

    async function persistStatusAndOrder(movedId, targetStatus, orderedIds, changedPositions, statusChanged, now) {
        try {
            const tasks = [];

            if (statusChanged) {
                const movedIndex = orderedIds.indexOf(String(movedId));
                tasks.push(
                    updateJobInDb(movedId, {
                        status: targetStatus,
                        is_completed: targetStatus === 'done',
                        position: movedIndex >= 0 ? movedIndex : 0,
                        updated_at: now
                    })
                );
            }

            if (targetStatus !== 'done' && changedPositions.length > 0) {
                changedPositions.forEach(({ id, position }) => {
                    if (!String(id).startsWith('temp-')) {
                        tasks.push(sb.from('jobs').update({ position }).eq('id', id));
                    }
                });
            }

            const results = await Promise.all(tasks);
            const failed = results.find(r => r && r.error);
            if (failed) {
                console.error('Senkronizasyon hatası:', failed.error);
                fetchJobs();
            }
        } catch (err) {
            console.error('Senkronizasyon hatası:', err);
            fetchJobs();
        }
    }

    function optimisticAddJob(title, colKey, focusInputId) {
        const groups = getGroupedJobs();
        const colItems = groups[colKey] || [];
        const maxPos = colItems.reduce((max, item) => Math.max(max, item.position || 0), -1);
        const now = new Date().toISOString();
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        const optimisticJob = {
            id: tempId,
            title,
            status: colKey,
            is_completed: colKey === 'done',
            position: maxPos + 1,
            created_at: now,
            updated_at: now
        };

        allJobs.push(optimisticJob);
        renderBoard();

        if (focusInputId) {
            const nextInput = document.getElementById(focusInputId);
            if (nextInput) nextInput.focus();
        }

        // Persist in background and swap temp ID silently
        insertJobInDb(title, colKey).then(res => {
            if (res.error) {
                alert('İş eklenemedi!');
                console.error(res.error);
                allJobs = allJobs.filter(j => j.id !== tempId);
                renderBoard();
                return;
            }
            if (res.data && res.data[0]) {
                const realJob = res.data[0];
                const idx = allJobs.findIndex(j => j.id === tempId);
                if (idx !== -1) {
                    allJobs[idx] = { ...realJob, status: realJob.status || colKey };
                }
                // Swap only this card in DOM so active typing is never interrupted
                const cardEl = document.querySelector(`.kanban-card[data-id="${tempId}"]`);
                if (cardEl) {
                    const tmp = document.createElement('div');
                    tmp.innerHTML = renderCard(allJobs[idx] || realJob, colKey).trim();
                    const newCard = tmp.firstElementChild;
                    if (newCard) {
                        cardEl.replaceWith(newCard);
                        if (typeof lucide !== 'undefined') lucide.createIcons();
                    }
                }
            }
        });
    }

    // Public handlers
    window.fetchJobs = fetchJobs;

    window.kanbanSetQuickTarget = function (colKey) {
        quickAddTarget = colKey;
        const inputVal = document.getElementById('kanban-top-input')?.value || '';
        renderBoard();
        const input = document.getElementById('kanban-top-input');
        if (input) {
            input.value = inputVal;
            input.focus();
        }
    };

    window.kanbanSubmitTopAdd = function () {
        const input = document.getElementById('kanban-top-input');
        if (!input) return;
        const title = input.value.trim();
        if (!title) {
            input.focus();
            return;
        }
        optimisticAddJob(title, quickAddTarget, 'kanban-top-input');
    };

    window.kanbanSetMobileCol = function (colKey) {
        mobileActiveCol = colKey;
        renderBoard();
    };

    window.kanbanOnSearch = function (val) {
        searchQuery = val;
        const input = document.getElementById('kanban-search-input');
        const cursorPos = input ? input.selectionStart : val.length;
        renderBoard();
        const newInput = document.getElementById('kanban-search-input');
        if (newInput) {
            newInput.focus();
            newInput.setSelectionRange(cursorPos, cursorPos);
        }
    };

    window.kanbanClearSearch = function () {
        searchQuery = '';
        renderBoard();
    };

        window.kanbanToggleDoneDay = function (dayKey) {
            if (expandedDoneDays.has(dayKey)) expandedDoneDays.delete(dayKey);
            else expandedDoneDays.add(dayKey);
            renderBoard();
        };

        window.kanbanToggleDoneMonth = function (monthKey) {
            if (expandedDoneMonths.has(monthKey)) expandedDoneMonths.delete(monthKey);
            else expandedDoneMonths.add(monthKey);
            renderBoard();
        };

        window.kanbanOpenQuickAdd = function (colKey) {
            editingJobId = null;
            activeAddColumn = colKey;
            renderBoard();
            const input = document.getElementById(`kanban-add-input-${colKey}`);
            if (input) input.focus();
        };

        window.kanbanCancelQuickAdd = function () {
            activeAddColumn = null;
            renderBoard();
        };

        window.kanbanSubmitQuickAdd = function (colKey) {
            const input = document.getElementById(`kanban-add-input-${colKey}`);
            if (!input) return;
            const title = input.value.trim();
            if (!title) {
                activeAddColumn = null;
                renderBoard();
                return;
            }

            activeAddColumn = colKey;
            optimisticAddJob(title, colKey, `kanban-add-input-${colKey}`);
        };

        window.kanbanMoveJob = function (id, targetStatus) {
            const job = allJobs.find(j => String(j.id) === String(id));
            if (!job) return;

            const groups = getGroupedJobs();
            const targetItems = groups[targetStatus] || [];
            const maxPos = targetItems.reduce((max, item) => Math.max(max, item.position || 0), -1);
            const now = new Date().toISOString();
            const newPos = targetStatus === 'done' ? 0 : maxPos + 1;

            // Instant optimistic update
            job.status = targetStatus;
            job.is_completed = targetStatus === 'done';
            job.position = newPos;
            job.updated_at = now;
            if (hasStatusColumn === false) {
                setLocalApprovalId(id, targetStatus === 'approval');
            }
            renderBoard();

            // Sync in background
            if (!String(id).startsWith('temp-')) {
                updateJobInDb(id, {
                    status: targetStatus,
                    is_completed: targetStatus === 'done',
                    position: newPos,
                    updated_at: now
                }).then(res => {
                    if (res.error) {
                        alert('Durum güncellenemedi!');
                        console.error(res.error);
                        fetchJobs();
                    }
                });
            }
        };

        window.kanbanStartEdit = function (id) {
            activeAddColumn = null;
            editingJobId = id;
            renderBoard();
        };

        window.kanbanCancelEdit = function () {
            editingJobId = null;
            renderBoard();
        };

        window.kanbanSaveEdit = function (id) {
            const input = document.getElementById(`kanban-edit-input-${id}`);
            if (!input) return;
            const title = input.value.trim();
            if (!title) {
                editingJobId = null;
                renderBoard();
                return;
            }

            const job = allJobs.find(j => String(j.id) === String(id));
            const now = new Date().toISOString();
            if (job) {
                job.title = title;
                job.updated_at = now;
            }

            editingJobId = null;
            renderBoard();

            if (!String(id).startsWith('temp-')) {
                sb.from('jobs')
                    .update({ title, updated_at: now })
                    .eq('id', id)
                    .then(({ error }) => {
                        if (error) {
                            alert('Güncelleme hatası!');
                            console.error(error);
                            fetchJobs();
                        }
                    });
            }
        };

        window.kanbanDeleteJob = function (id) {
            if (!confirm('Bu işi silmek istediğinize emin misiniz?')) return;

            allJobs = allJobs.filter(j => String(j.id) !== String(id));
            setLocalApprovalId(id, false);
            renderBoard();

            if (!String(id).startsWith('temp-')) {
                sb.from('jobs')
                    .delete()
                    .eq('id', id)
                    .then(({ error }) => {
                        if (error) {
                            alert('Silme hatası!');
                            console.error(error);
                            fetchJobs();
                        }
                    });
            }
        };
    }) ();
