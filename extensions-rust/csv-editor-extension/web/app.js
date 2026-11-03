(function () {
	const DATA = window.__SIDEX_DATA__ || [];
	const vscode = acquireVsCodeApi();
	const header = (DATA[0] || []).map((value) => String(value));
	const rows = DATA.slice(1).map((cells, index) => ({ index: index + 1, cells: cells.map((value) => String(value)) }));
	const columnCount = header.length;
	const filters = new Array(columnCount).fill('');
	const filterInputs = new Array(columnCount);
	const numericColumns = header.map((_, column) => {
		let seen = false;
		for (const row of rows) {
			const value = (row.cells[column] || '').trim();
			if (!value) { continue; }
			if (!/^-?\d+(\.\d+)?$/.test(value)) { return false; }
			seen = true;
		}
		return seen;
	});
	let globalFilter = '';
	let sortColumn = -1;
	let sortDirection = 0;

	const thead = document.getElementById('thead');
	const tbody = document.getElementById('tbody');
	const empty = document.getElementById('empty');
	const status = document.getElementById('status');
	const meta = document.getElementById('meta');
	const saveHint = document.getElementById('save-hint');
	const filterToggle = document.getElementById('toggle-filters');
	const sortReset = document.getElementById('clear-sort');

	const headRow = document.createElement('tr');
	headRow.className = 'head-row';
	const corner = document.createElement('th');
	corner.className = 'corner';
	corner.textContent = '#';
	headRow.appendChild(corner);

	const filterRow = document.createElement('tr');
	filterRow.className = 'filter-row';
	filterRow.hidden = true;
	const filterCorner = document.createElement('th');
	filterCorner.className = 'corner';
	filterRow.appendChild(filterCorner);

	header.forEach((name, column) => {
		const th = document.createElement('th');
		th.dataset.column = column;
		const head = document.createElement('div');
		head.className = 'col-head';
		const label = document.createElement('span');
		label.className = 'col-label';
		label.textContent = name || `列 ${column + 1}`;
		const indicator = document.createElement('span');
		indicator.className = 'sort-ind';
		head.append(label, indicator);

		const menu = document.createElement('button');
		menu.className = 'col-menu';
		menu.title = '筛选此列';
		menu.setAttribute('aria-label', '筛选此列');
		menu.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5L6 8l3.5-3.5"></path></svg>';
		menu.addEventListener('click', (event) => {
			event.stopPropagation();
			setFiltersVisible(true);
			filterInputs[column]?.focus();
		});
		head.appendChild(menu);

		head.addEventListener('click', () => cycleSort(column));
		th.appendChild(head);
		headRow.appendChild(th);

		const filterCell = document.createElement('th');
		filterCell.className = 'filter-cell';
		const input = document.createElement('input');
		input.type = 'text';
		input.placeholder = '筛选';
		input.spellcheck = false;
		input.autocomplete = 'off';
		input.addEventListener('input', () => {
			filters[column] = input.value.trim().toLowerCase();
			apply();
		});
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				input.value = '';
				filters[column] = '';
				apply();
			}
		});
		filterInputs[column] = input;
		filterCell.appendChild(input);
		filterRow.appendChild(filterCell);
	});

	thead.append(headRow, filterRow);

	filterToggle.addEventListener('click', () => setFiltersVisible(filterRow.hidden));

	sortReset.addEventListener('click', () => {
		sortColumn = -1;
		sortDirection = 0;
		apply();
	});

	document.getElementById('global-filter').addEventListener('input', (event) => {
		globalFilter = event.target.value.trim().toLowerCase();
		apply();
	});

	function setFiltersVisible(visible) {
		filterRow.hidden = !visible;
		filterToggle.classList.toggle('active', visible);
	}

	function cycleSort(column) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 1 ? -1 : sortDirection === -1 ? 0 : 1;
			if (sortDirection === 0) { sortColumn = -1; }
		} else {
			sortColumn = column;
			sortDirection = 1;
		}
		apply();
	}

	function decorateHeader() {
		const sorted = sortColumn >= 0 && sortDirection !== 0;
		sortReset.disabled = !sorted;
		thead.querySelectorAll('th[data-column]').forEach((th) => {
			const column = Number(th.dataset.column);
			const active = sorted && sortColumn === column;
			th.classList.toggle('sorted', active);
			th.querySelector('.sort-ind').textContent = active ? (sortDirection === 1 ? '▲' : '▼') : '';
		});
	}

	function apply() {
		const visible = rows.filter((row) => {
			for (let column = 0; column < columnCount; column++) {
				const value = (row.cells[column] || '').toLowerCase();
				const filter = filters[column];
				if (filter && !value.includes(filter)) { return false; }
				if (globalFilter && !value.includes(globalFilter)) { return false; }
			}
			return true;
		});

		if (sortColumn >= 0 && sortDirection !== 0) {
			const column = sortColumn;
			const direction = sortDirection;
			const numeric = numericColumns[column];
			visible.sort((left, right) => {
				const a = (left.cells[column] || '').trim();
				const b = (right.cells[column] || '').trim();
				if (!a && !b) { return 0; }
				if (!a) { return 1; }
				if (!b) { return -1; }
				if (numeric) { return direction * (Number(a) - Number(b)); }
				return direction * a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });
			});
		}

		renderBody(visible);
		decorateHeader();

		meta.textContent = `${columnCount} 列 · ${rows.length} 行`;
		status.textContent = visible.length === rows.length ? `${rows.length} 行` : `显示 ${visible.length} / ${rows.length} 行`;
		empty.hidden = visible.length > 0;
	}

	function renderBody(visible) {
		const fragment = document.createDocumentFragment();
		visible.forEach((record, position) => {
			const tr = document.createElement('tr');
			const numberCell = document.createElement('td');
			numberCell.className = 'rn';
			numberCell.textContent = String(position + 1);
			tr.appendChild(numberCell);

			for (let column = 0; column < columnCount; column++) {
				const cell = document.createElement('td');
				cell.contentEditable = 'true';
				cell.spellcheck = false;
				cell.dataset.index = record.index;
				cell.dataset.column = column;
				if (numericColumns[column]) { cell.classList.add('num'); }
				cell.textContent = record.cells[column] || '';
				attachEditing(cell);
				tr.appendChild(cell);
			}
			fragment.appendChild(tr);
		});
		tbody.replaceChildren(fragment);
	}

	function attachEditing(cell) {
		cell.addEventListener('focus', () => {
			cell.dataset.original = cell.textContent;
		});
		cell.addEventListener('blur', () => commit(cell));
		cell.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				commit(cell);
				moveFocus(cell, 'down');
			} else if (event.key === 'Tab') {
				event.preventDefault();
				commit(cell);
				moveFocus(cell, event.shiftKey ? 'left' : 'right');
			} else if (event.key === 'Escape') {
				event.preventDefault();
				cell.textContent = cell.dataset.original || '';
				cell.dataset.skipCommit = 'true';
				cell.blur();
			}
		});
	}

	function commit(cell) {
		if (cell.dataset.skipCommit === 'true') {
			delete cell.dataset.skipCommit;
			cell.dataset.original = cell.textContent;
			return;
		}
		const index = Number(cell.dataset.index);
		const column = Number(cell.dataset.column);
		const value = (cell.textContent || '').replace(/\r?\n/g, ' ');
		const record = rows.find((row) => row.index === index);
		if (!record || record.cells[column] === value) { return; }
		record.cells[column] = value;
		cell.textContent = value;
		vscode.postMessage({ type: 'edit', row: index, col: column, value });
		flashSaved();
	}

	function moveFocus(cell, direction) {
		const row = cell.parentElement;
		const column = Number(cell.dataset.column);
		if (direction === 'down') {
			const nextRow = row.nextElementSibling;
			nextRow?.children[column + 1]?.focus();
		} else if (direction === 'right') {
			const nextCell = cell.nextElementSibling;
			if (nextCell) {
				nextCell.focus();
			} else {
				row.nextElementSibling?.children[1]?.focus();
			}
		} else if (direction === 'left') {
			const previousCell = cell.previousElementSibling;
			if (previousCell && !previousCell.classList.contains('rn')) {
				previousCell.focus();
			} else {
				const previousRow = row.previousElementSibling;
				previousRow?.children[previousRow.children.length - 1]?.focus();
			}
		}
	}

	let saveTimer;
	function flashSaved() {
		saveHint.classList.add('show');
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => saveHint.classList.remove('show'), 1200);
	}

	apply();
})();
