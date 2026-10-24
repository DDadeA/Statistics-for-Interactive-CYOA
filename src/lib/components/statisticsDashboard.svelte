<script lang="ts">
	import { translations } from '$lib/translations';
	import type { LogEntry, Word } from '$lib/types';
	import CorrelationTable from './correlationTable.svelte';
	import { cleanURL } from '$lib/utils';

	let {
		logData = [],
		projectData = null,
		progressMessage = '',
		currentLang = 'en',
		urlOptions = []
	} = $props();

	// Filters
	let uniqueUsersOnly = $state(false);
	let timeRange = $state('all'); // 'all', '24h', '7d', '30d'
	let selectedFilterChoice = $state('');
	let selectedFilterChoiceCount = $state(0);
	let urlFilter = $state(''); // ''==no filter.

	// display option
	let timeUnit = $state('day'); // 'day', 'hour', 'week'
	let isLogarithmicTime = $state(false);

	// word modal
	let wordModalId = $state<string | null>(null);
	let modalWord = $derived(
		wordModalId === null ? null : (wordStatistics.find((w) => w.id === wordModalId) ?? null)
	);

	let t = $derived(translations[currentLang as keyof typeof translations] || translations['en']);
	let original_url = $derived(
		logData.length > 0 && logData[0].current_url ? logData[0].current_url : ''
	);

	// =================================================================================================
	// 4. DATA PROCESSING PIPELINE
	// =================================================================================================
	let parsedLogData: LogEntry[] = $derived(
		logData.map((entry) => {
			let parsedData = entry.parsedData;
			if (parsedData == null) {
				try {
					parsedData = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
				} catch {
					parsedData = {};
				}
			}

			if (Array.isArray(parsedData?.selectedChoices)) {
				parsedData = { ...parsedData, selectedChoices: [...parsedData.selectedChoices].sort() };
			}
			return {
				...entry,
				data: null, // Free up memory
				parsedData: parsedData || {},
				timestamp: entry.timestamp ?? new Date(entry.created_at).getTime()
			};
		})
	);

	let filteredLogData = $derived.by(() => {
		let data = parsedLogData;

		// 1. Time Filter (Numeric comparison is faster)
		if (timeRange !== 'all') {
			const now = Date.now();
			let cutoff = now;
			if (timeRange === '24h') cutoff -= 24 * 60 * 60 * 1000;
			if (timeRange === '7d') cutoff -= 7 * 24 * 60 * 60 * 1000;
			if (timeRange === '30d') cutoff -= 30 * 24 * 60 * 60 * 1000;
			data = data.filter((e) => (e.timestamp ?? 0) >= cutoff);
		}

		// 2. Filter by Choice
		if (selectedFilterChoice != '') {
			data = data.filter(
				(entry) =>
					entry.parsedData.selectedChoices &&
					entry.parsedData.selectedChoices.includes(selectedFilterChoice)
			);
		}

		// 3. URL Filter
		if (urlFilter != '') {
			data = data.filter((entry) => {
				const currentUrl = cleanURL(entry.current_url);
				return currentUrl && currentUrl.includes(urlFilter);
			});
		}

		if (selectedFilterChoiceCount > 0) {
			data = data.filter(
				(entry) =>
					entry.parsedData.selectedChoices &&
					entry.parsedData.selectedChoices.length >= selectedFilterChoiceCount
			);
		}

		// 3. Keep the latest matching record for each user.
		if (uniqueUsersOnly) {
			const latestEntries = new Map<string, LogEntry>();
			for (const entry of data) {
				if (!latestEntries.has(entry.uid)) latestEntries.set(entry.uid, entry);
			}
			data = Array.from(latestEntries.values());
		}

		return data;
	});

	let uniqueVisitorCount = $derived(new Set(filteredLogData.map((entry) => entry.uid)).size);

	let statisticsCounts = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const entry of filteredLogData) {
			const choices = entry.parsedData.selectedChoices;
			if (Array.isArray(choices)) {
				for (const id of choices) {
					counts[id] = (counts[id] || 0) + 1;
				}
			}
		}
		return counts;
	});

	let objectMap = $derived.by(() => {
		const map: Record<string, any> = {};
		if (projectData?.rows) {
			for (const row of projectData.rows) {
				if (row.objects) {
					for (const obj of row.objects) {
						map[obj.id] = obj;
					}
				}
			}
		}
		return map;
	});

	let objectToRowMap = $derived.by(() => {
		const map: Record<string, { id: string; title: string }> = {};
		if (projectData?.rows) {
			for (const row of projectData.rows) {
				if (row.objects) {
					for (const obj of row.objects) {
						map[obj.id] = { id: row.id, title: row.title || row.id };
					}
				}
			}
		}
		return map;
	});

	// =================================================================================================
	// 5. STATISTICS CALCULATION BLOCKS
	// =================================================================================================

	// --- 1. Visitor Graph ---
	let visitorGraphData = $derived.by(() => {
		const groupedData: Record<string, Set<string>> = {};

		for (const entry of filteredLogData) {
			const date = new Date(entry.timestamp ?? 0);
			let key = '';

			if (timeUnit === 'hour') {
				date.setMinutes(0, 0, 0);
				key = date.toISOString();
			} else if (timeUnit === 'week') {
				const day = date.getDay();
				const diff = date.getDate() - day + (day === 0 ? -6 : 1);
				date.setDate(diff);
				date.setHours(0, 0, 0, 0);
				key = date.toISOString();
			} else {
				date.setHours(0, 0, 0, 0);
				key = date.toISOString();
			}
			groupedData[key] ??= new Set();
			groupedData[key].add(entry.uid);
		}

		let sorted = Object.entries(groupedData)
			.map(([dateStr, count]) => {
				const date = new Date(dateStr);
				let label = '';
				if (timeUnit === 'hour')
					label = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
				else label = `${date.getMonth() + 1}/${date.getDate()}`;

				return {
					date: dateStr,
					count: count.size,
					visitors: count,
					timestamp: date.getTime(),
					label,
					accumulated: 0
				};
			})
			.sort((a, b) => a.timestamp - b.timestamp);

		const maxGraphPoints = 120;
		if (sorted.length > maxGraphPoints) {
			const bucketSize = Math.ceil(sorted.length / maxGraphPoints);
			sorted = Array.from({ length: Math.ceil(sorted.length / bucketSize) }, (_, index) => {
				const start = index * bucketSize;
				const group = sorted.slice(start, start + bucketSize);
				const first = group[0];
				const last = group[group.length - 1];
				const visitors = new Set(group.flatMap((item) => [...item.visitors]));
				return {
					...first,
					count: visitors.size,
					visitors,
					label: `${first.label}–${last.label}`
				};
			});
		}

		const accumulatedVisitors = new Set<string>();
		return sorted.map((item) => {
			for (const visitor of item.visitors) accumulatedVisitors.add(visitor);
			return { ...item, accumulated: accumulatedVisitors.size };
		});
	});

	// --- 2. General Stats & Time Distribution ---
	let generalData = $derived.by(() => {
		let totalTime = 0;
		let timeCount = 0;
		const viewports: Record<string, number> = {};
		const times: number[] = [];
		let totalViewportCount = 0;

		for (const entry of filteredLogData) {
			const d = entry.parsedData;
			if (d.timeOnPage) {
				totalTime += d.timeOnPage;
				timeCount++;
				times.push(d.timeOnPage / 1000);
			}
			if (d.viewportSize) {
				let key = d.viewportSize;
				const parts = d.viewportSize.split('x');
				if (parts.length === 2) key = `${parts[0]}px (Width)`;
				viewports[key] = (viewports[key] || 0) + 1;
				totalViewportCount++;
			}
		}

		// Stats
		const stats = {
			avgTimeOnPage: timeCount > 0 ? Math.round(totalTime / timeCount / 1000) : 0,
			totalTimeOnPage: Math.round(totalTime / 1000),
			topViewports: Object.entries(viewports)
				.sort(([, a], [, b]) => b - a)
				.slice(0, 5),
			totalViewportCount,
			medianTimeOnPage: -1
		};

		// Median
		let median = 0;
		times.sort((a, b) => a - b);
		if (times.length > 0) {
			const mid = Math.floor(times.length / 2);
			median = times.length % 2 === 0 ? (times[mid - 1] + times[mid]) / 2 : times[mid];
		}
		stats.medianTimeOnPage = Math.round(median);

		const percentile = (p: number) =>
			times.length > 0
				? Math.round(times[Math.min(times.length - 1, Math.floor(times.length * p))])
				: 0;
		const percentiles = [
			{ label: 'P25', value: percentile(0.25) },
			{ label: t.median, value: stats.medianTimeOnPage },
			{ label: 'P75', value: percentile(0.75) },
			{ label: 'P90', value: percentile(0.9) }
		];

		// Retention curve: share of sessions that stayed at least x seconds
		let curve: {
			path: string;
			ticks: { x: number; label: string }[];
			points: { x: number; seconds: number; percent: number }[];
		} | null = null;
		if (times.length > 0) {
			const POINTS = 80;
			const xMin = isLogarithmicTime ? 1 : 0;
			const p = isLogarithmicTime ? 0.99 : 0.95;
			const xMax = Math.max(times[Math.min(times.length - 1, Math.floor(times.length * p))], 60);
			const position = (seconds: number) =>
				isLogarithmicTime
					? Math.log(Math.max(seconds, xMin) / xMin) / Math.log(xMax / xMin)
					: seconds / xMax;

			// Number of sessions with time >= seconds, via binary search on the sorted array
			const countAtLeast = (seconds: number) => {
				let lo = 0;
				let hi = times.length;
				while (lo < hi) {
					const mid = (lo + hi) >> 1;
					if (times[mid] < seconds) lo = mid + 1;
					else hi = mid;
				}
				return times.length - lo;
			};

			const points = Array.from({ length: POINTS + 1 }, (_, i) => {
				const seconds = isLogarithmicTime
					? xMin * (xMax / xMin) ** (i / POINTS)
					: (xMax * i) / POINTS;
				return {
					x: i / POINTS,
					seconds,
					percent: (countAtLeast(seconds) / times.length) * 100
				};
			});

			const tickSeconds = isLogarithmicTime
				? [1, 5, 10, 30, 60, 300, 600, 1800, 3600, 7200, 21600, 86400].filter((s) => s <= xMax)
				: Array.from({ length: 5 }, (_, i) => Math.round((xMax * i) / 4));

			curve = {
				path: points
					.map(
						(pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(4)},${(100 - pt.percent).toFixed(2)}`
					)
					.join(' '),
				ticks: tickSeconds.map((s) => ({ x: position(s), label: formatTime(s) })),
				points
			};
		}

		return { stats, percentiles, curve };
	});

	let generalStats = $derived(generalData.stats);
	let timePercentiles = $derived(generalData.percentiles);
	let retentionCurve = $derived(generalData.curve);

	// --- 4. Row Statistics (Heavily Optimized) ---
	let rowStatistics = $derived.by(() => {
		if (!projectData?.rows) return [];
		const result = projectData.rows.map((row: any) => {
			const rowObjects = row.objects || [];
			let rowTotal = 0;

			// Retrieve counts from the global statisticsCounts (O(1) lookup)
			// No more looping through logData here!
			const objectStats = rowObjects.map((obj: any) => {
				const count = statisticsCounts[obj.id] || 0;
				rowTotal += count;
				return { ...obj, count };
			});

			// Calculate percentages
			const enrichedStats = objectStats
				.map((obj: any) => ({
					...obj,
					percentInRow: rowTotal > 0 ? (obj.count / rowTotal) * 100 : 0,
					percentTotal: filteredLogData.length > 0 ? (obj.count / filteredLogData.length) * 100 : 0
				}))
				.sort((a: any, b: any) => b.count - a.count);

			return {
				...row,
				totalSelections: rowTotal,
				objectStats: enrichedStats
			};
		});
		return result;
	});

	// --- 5. Exit Statistics ---
	let exitRowStats = $derived.by(() => {
		if (filteredLogData.length === 0 || Object.keys(objectToRowMap).length === 0) return [];

		const exitCounts: Record<string, number> = {};
		let validExits = 0;

		for (const entry of filteredLogData) {
			const choices = entry.parsedData.selectedChoices;
			if (choices && choices.length > 0) {
				const lastChoice = choices[choices.length - 1];
				const rowInfo = objectToRowMap[lastChoice];
				if (rowInfo) {
					exitCounts[rowInfo.id] = (exitCounts[rowInfo.id] || 0) + 1;
					validExits++;
				}
			}
		}

		const result = Object.entries(exitCounts)
			.map(([rowId, count]) => {
				const row = projectData.rows.find((r: any) => r.id === rowId);
				return {
					id: rowId,
					title: row ? row.title || row.id : rowId,
					count,
					percent: validExits > 0 ? (count / validExits) * 100 : 0
				};
			})
			.sort((a, b) => b.count - a.count);

		return result;
	});

	// --- 6. User Words (Moved out of HTML) ---
	let wordStatistics = $derived.by(() => {
		const wordStat: Record<string, Record<string, number>> = {};

		for (const entry of filteredLogData) {
			const words = entry.parsedData?.words as Word[] | undefined;
			if (words && Array.isArray(words)) {
				for (const word of words) {
					if (word.replaceText == null) continue;
					const replaceText = word.replaceText.trim() || '(empty)';

					// Register word occurrence
					if (!wordStat[word.id]) {
						wordStat[word.id] = { [replaceText]: 1 };
						continue;
					}

					const wordObj = wordStat[word.id];
					// Register replaceText occurrence
					if (!wordObj[replaceText]) {
						wordObj[replaceText] = 1;
						continue;
					}

					wordObj[replaceText] += 1;
				}
			}
		}
		const result = Object.entries(wordStat).map(([id, variants]) => {
			const variantArray = Object.entries(variants)
				.map(([replaceText, count]) => ({ replaceText, count }))
				.sort((a: any, b: any) => b.count - a.count);
			const totalCount = variantArray.reduce((sum: number, v: any) => sum + v.count, 0);
			return { id, totalCount, variants: variantArray };
		});

		return result;
	});

	// --- 7. Item Quantities (items that can be added multiple times) ---
	type QuantitySort = 'units' | 'users' | 'avg' | 'max' | 'multi';
	let quantitySort = $state<QuantitySort>('units');

	const QUANTITY_BINS = [
		{ label: '1', test: (n: number) => n === 1, color: '#3b82f6' },
		{ label: '2', test: (n: number) => n === 2, color: '#22c55e' },
		{ label: '3-5', test: (n: number) => n >= 3 && n <= 5, color: '#f59e0b' },
		{ label: '6+', test: (n: number) => n >= 6, color: '#ef4444' }
	];

	let quantityModalId = $state<string | null>(null);
	let modalItem = $derived(
		quantityModalId === null
			? null
			: (itemQuantityStats.find((item) => item.id === quantityModalId) ?? null)
	);

	let itemQuantityStats = $derived.by(() => {
		const byItem = new Map<string, number[]>();
		for (const entry of filteredLogData) {
			const vars = entry.parsedData.multipleUseVariable;
			if (!Array.isArray(vars)) continue;
			for (const item of vars) {
				const count = Number(item?.count);
				if (!item?.id || !Number.isFinite(count) || count <= 0) continue;
				const list = byItem.get(item.id);
				if (list) list.push(count);
				else byItem.set(item.id, [count]);
			}
		}

		const totalEntries = Math.max(filteredLogData.length, 1);
		const rows = [...byItem.entries()].map(([id, counts]) => {
			const sorted = [...counts].sort((a, b) => a - b);
			const units = sorted.reduce((sum, n) => sum + n, 0);
			const mid = Math.floor(sorted.length / 2);
			const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
			const distributionMap = new Map<number, number>();
			for (const n of sorted) distributionMap.set(n, (distributionMap.get(n) ?? 0) + 1);
			return {
				id,
				distribution: [...distributionMap.entries()].map(([quantity, users]) => ({
					quantity,
					users
				})),
				users: counts.length,
				adoption: (counts.length / totalEntries) * 100,
				units,
				avg: units / counts.length,
				median,
				max: sorted[sorted.length - 1],
				multi: (counts.filter((n) => n > 1).length / counts.length) * 100,
				bins: QUANTITY_BINS.map((bin) => ({
					label: bin.label,
					color: bin.color,
					count: counts.filter(bin.test).length
				}))
			};
		});

		return rows.sort((a, b) => b[quantitySort] - a[quantitySort]);
	});

	// --- 8. All Known Choices List ---
	let allKnownChoices = $derived(Object.keys(statisticsCounts).sort());

	// Utils
	function formatTime(seconds: number): string {
		if (seconds < 60) return `${seconds}s`;
		const mins = Math.floor(seconds / 60);
		if (mins < 60) return `${mins}m`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h`;
		const days = Math.floor(hours / 24);
		return `${days}d ${hours % 24}h`;
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key !== 'Escape') return;
		if (wordModalId !== null) wordModalId = null;
		if (quantityModalId !== null) quantityModalId = null;
	}}
/>

<div>
	<!-- Table of Contents -->
	<div class="toc">
		<h2>{t.toc}</h2>
		<ul>
			<li><a href="#controls">{t.controls}</a></li>
			<li><a href="#visitor-graph">{t.visitorGraph}</a></li>
			<li><a href="#general-stats">{t.generalStats}</a></li>
			<li><a href="#time-distribution">{t.timeDistribution}</a></li>
			<li><a href="#correlations">{t.correlations}</a></li>
			<li><a href="#user-words">{t.userEnteredWords || 'User-Entered Words'}</a></li>
			<li><a href="#repeated-choices">{t.repeatedChoices || 'Repeated Choices'}</a></li>
			<li><a href="#exit-analysis">{t.exitAnalysis}</a></li>
			<li><a href="#row-analysis">{t.rowAnalysis}</a></li>
			<li><a href="#object-stats">{t.objectStats}</a></li>
		</ul>
	</div>

	<h2 id="controls">{t.statisticsControls}</h2>
	<div class="controls-section">
		<div class="filters">
			<label class="toggle">
				<input type="checkbox" bind:checked={uniqueUsersOnly} />
				<span class="slider"></span>
				<span class="label-text">{t.uniqueUsers}</span>
			</label>

			<div class="select-group">
				<label for="timeRange">{t.timeRange}</label>
				<select id="timeRange" bind:value={timeRange}>
					<option value="all">{t.allTime}</option>
					<option value="30d">{t.last30Days}</option>
					<option value="7d">{t.last7Days}</option>
					<option value="24h">{t.last24Hours}</option>
				</select>
			</div>

			<div class="select-group">
				<label for="filterChoice">{t.filterByChoice}</label>
				<select id="filterChoice" bind:value={selectedFilterChoice}>
					<option value="">{t.none}</option>
					{#each allKnownChoices as choice}
						<option value={choice}>{choice}</option>
					{/each}
				</select>
			</div>
			<div class="select-group">
				<label for="filterChoiceCount">{t.minChoicesSelected}</label>
				<input
					type="number"
					id="filterChoiceCount"
					min="0"
					bind:value={selectedFilterChoiceCount}
				/>
			</div>
			<div class="select-group">
				<label for="urlFilter">{t.filterByUrl}</label>
				<select id="urlFilter" bind:value={urlFilter}>
					<option value="">{t.none}</option>
					{#each urlOptions as option}
						<option value={option.url}>{option.count.toLocaleString()} · {option.url}</option>
					{/each}
				</select>
			</div>
		</div>
	</div>

	<!-- Visitor Graph -->
	<h2 id="visitor-graph">{t.visitorCount}</h2>
	<div class="select-group">
		<label for="timeUnit">{t.groupBy}</label>
		<select id="timeUnit" bind:value={timeUnit}>
			<option value="week">{t.week}</option>
			<option value="day">{t.day}</option>
			<option value="hour">{t.hour}</option>
		</select>
	</div>
	<div class="chart-container">
		{#if visitorGraphData.length > 0}
			{@const maxCount = Math.max(...visitorGraphData.map((d) => d.count), 1)}
			{@const maxAccumulated = Math.max(...visitorGraphData.map((d) => d.accumulated), 1)}
			<svg viewBox="0 0 1000 300" class="chart">
				<!-- X and Y Axis -->
				<line x1="50" y1="250" x2="950" y2="250" stroke="#ccc" />
				<line x1="50" y1="250" x2="50" y2="50" stroke="#ccc" />
				<line x1="950" y1="250" x2="950" y2="50" stroke="#ccc" />

				<!-- Bars -->
				{#each visitorGraphData as d, i}
					{@const slotWidth = 900 / visitorGraphData.length}
					{@const barWidth = slotWidth * 0.8}
					{@const x = 50 + i * slotWidth + (slotWidth - barWidth) / 2}
					{@const barHeight = (d.count / maxCount) * 200}
					<rect
						{x}
						y={250 - barHeight}
						width={barWidth}
						height={barHeight}
						fill="#3b82f6"
						opacity="0.6"
					>
						<title>{d.label}: {d.count}</title>
					</rect>
				{/each}

				<!-- Line (Accumulated) -->
				<polyline
					fill="none"
					stroke="#ef4444"
					stroke-width="2"
					points={visitorGraphData
						.map((d, i) => {
							const slotWidth = 900 / visitorGraphData.length;
							const x = 50 + i * slotWidth + slotWidth / 2;
							const y = 250 - (d.accumulated / maxAccumulated) * 200;
							return `${x},${y}`;
						})
						.join(' ')}
				/>

				<!-- Data Points -->
				{#each visitorGraphData as d, i}
					{@const slotWidth = 900 / visitorGraphData.length}
					{@const x = 50 + i * slotWidth + slotWidth / 2}
					{@const y = 250 - (d.accumulated / maxAccumulated) * 200}
					<circle cx={x} cy={y} r="3" fill="#ef4444" stroke="white" stroke-width="1">
						<title>{t.accumulatedTooltip}: {d.accumulated}</title>
					</circle>
				{/each}

				<!-- Labels -->
				{#each visitorGraphData as d, i}
					{#if i % Math.ceil(visitorGraphData.length / 6) === 0 || i === visitorGraphData.length - 1}
						{@const slotWidth = 900 / visitorGraphData.length}
						{@const x = 50 + i * slotWidth + slotWidth / 2}
						<text
							{x}
							y="270"
							font-size="12"
							fill="#666"
							text-anchor="middle"
							transform="rotate(0, {x}, 270)">{d.label}</text
						>
					{/if}
				{/each}

				<text x="40" y="50" font-size="12" fill="#3b82f6" text-anchor="end">{maxCount}</text>
				<text x="40" y="250" font-size="12" fill="#3b82f6" text-anchor="end">0</text>
				<text x="960" y="50" font-size="12" fill="#ef4444" text-anchor="start"
					>{maxAccumulated}</text
				>
				<text x="960" y="250" font-size="12" fill="#ef4444" text-anchor="start">0</text>
			</svg>
			<div class="chart-legend">
				<div class="legend-item">
					<span class="color-box bar"></span>
					<span>{t.periodCount}</span>
				</div>
				<div class="legend-item">
					<span class="color-box line"></span>
					<span>{t.accumulated}</span>
				</div>
			</div>
		{:else}
			<p class="text-gray italic">{t.notEnoughData}</p>
		{/if}
	</div>

	<!-- General Stats -->
	<h2 id="general-stats">{t.generalStatistics}</h2>
	<div class="stats-grid">
		<div class="stat-card">
			<h3>{t.sumOfTime}</h3>
			<p class="stat-value">{formatTime(generalStats.totalTimeOnPage || 0)}</p>
		</div>
		<div class="stat-card">
			<h3>{t.totalVisitors}</h3>
			<p class="stat-value">{uniqueVisitorCount.toLocaleString()}</p>
		</div>
		<div class="stat-card">
			<h3>{t.totalEntries}</h3>
			<p class="stat-value">{filteredLogData.length.toLocaleString()}</p>
		</div>
		<div class="stat-card wide">
			<h3>{t.topViewports}</h3>
			{#if generalStats.topViewports && generalStats.topViewports.length > 0}
				{@const colors = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7', '#9ca3af']}
				{@const top5Total = generalStats.topViewports.reduce(
					(sum: number, [, count]: any) => sum + count,
					0
				)}
				{@const otherCount = generalStats.totalViewportCount - top5Total}
				{@const pieData = [
					...generalStats.topViewports.map(([label, count]: any, i: number) => ({
						label,
						count,
						color: colors[i % colors.length]
					})),
					...(otherCount > 0 ? [{ label: t.other, count: otherCount, color: colors[5] }] : [])
				]}

				<div class="pie-chart-container">
					<svg viewBox="-1 -1 2 2" style="transform: rotate(-90deg)" class="pie-chart">
						{#each pieData as slice, i}
							{@const total = generalStats.totalViewportCount}
							{@const startAngle = pieData
								.slice(0, i)
								.reduce((sum, d) => sum + (d.count / total) * 2 * Math.PI, 0)}
							{@const sliceAngle = (slice.count / total) * 2 * Math.PI}
							{@const x1 = Math.cos(startAngle)}
							{@const y1 = Math.sin(startAngle)}
							{@const x2 = Math.cos(startAngle + sliceAngle)}
							{@const y2 = Math.sin(startAngle + sliceAngle)}
							{@const largeArcFlag = sliceAngle > Math.PI ? 1 : 0}

							<path d="M 0 0 L {x1} {y1} A 1 1 0 {largeArcFlag} 1 {x2} {y2} Z" fill={slice.color}>
								<title
									>{slice.label}: {slice.count} ({((slice.count / total) * 100).toFixed(1)}%)</title
								>
							</path>
						{/each}
					</svg>
					<div class="pie-legend">
						{#each pieData as slice}
							<div class="legend-item">
								<span class="color-box" style="background-color: {slice.color}"></span>
								<span class="legend-label" title={slice.label}>{slice.label}</span>
								<span class="legend-value"
									>{((slice.count / generalStats.totalViewportCount) * 100).toFixed(1)}%</span
								>
							</div>
						{/each}
					</div>
				</div>
			{:else}
				<p class="text-gray italic">{t.noViewportData}</p>
			{/if}
		</div>
	</div>

	<!-- Time on Page -->
	<h2 id="time-distribution">
		{t.timeOnPageDistribution}
		<span class="text-sm font-normal text-gray ml-2">
			({t.avg}: {formatTime(generalStats.avgTimeOnPage)}, {t.median}: {formatTime(
				generalStats.medianTimeOnPage
			)})
		</span>
		<label class="toggle inline-toggle">
			<input type="checkbox" bind:checked={isLogarithmicTime} />
			<span class="slider small"></span>
			<span class="label-text text-sm font-normal">{t.logarithmicScale}</span>
		</label>
	</h2>
	<div class="chart-container">
		{#if retentionCurve}
			<p class="text-sm text-gray" style="margin-bottom: 0.75rem;">{t.retentionHint}</p>
			<div class="percentile-row">
				{#each timePercentiles as item}
					<div class="percentile-card">
						<span class="meta-label">{item.label}</span>
						<span class="meta-value">{formatTime(item.value)}</span>
					</div>
				{/each}
			</div>
			<svg class="retention-chart" viewBox="0 0 640 260" role="img" aria-label={t.retentionHint}>
				<g transform="translate(48 12)">
					{#each [0, 25, 50, 75, 100] as tick}
						<line
							x1="0"
							x2="570"
							y1={216 - (tick / 100) * 216}
							y2={216 - (tick / 100) * 216}
							class="grid-line"
						/>
						<text x="-8" y={220 - (tick / 100) * 216} text-anchor="end" class="axis-text"
							>{tick}%</text
						>
					{/each}
					{#each retentionCurve.ticks as tick}
						<text x={tick.x * 570} y="236" text-anchor="middle" class="axis-text">{tick.label}</text
						>
					{/each}
					<g transform="scale(570 2.16)">
						<path d={`${retentionCurve.path} L1,100 L0,100 Z`} class="curve-area" />
						<path d={retentionCurve.path} class="curve-line" vector-effect="non-scaling-stroke" />
					</g>
					{#each retentionCurve.points as pt}
						<rect x={pt.x * 570 - 4} y="0" width="8" height="216" fill="transparent">
							<title
								>{pt.percent.toFixed(1)}% {t.stayedAtLeast}
								{formatTime(Math.round(pt.seconds))}</title
							>
						</rect>
					{/each}
				</g>
			</svg>
		{:else}
			<p class="text-gray italic">{t.noTimeData}</p>
		{/if}
	</div>

	<CorrelationTable {t} {filteredLogData} {objectMap} />

	<!-- User-Entered Words -->
	<h2 id="user-words">{t.userEnteredWords || 'User-Entered Words'}</h2>
	<div class="words-container">
		{#if wordStatistics.length > 0}
			<div class="grid">
				{#each wordStatistics as word}
					<div class="card">
						<h3>{word.id}</h3>
						<p class="text-sm text-gray" style="margin-bottom: 0.5rem;">
							{t.totalEntries}:
							<span class="font-bold text-blue">{word.totalCount}</span>
						</p>

						<div style="display: flex; flex-direction: column; gap: 0.5rem;">
							{#each word.variants.slice(0, 10) as variant}
								<div>
									<div
										style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 0.125rem;"
									>
										<span class="break-words" style="font-weight: 500;"
											>"{variant.replaceText}"</span
										>
										<span class="text-gray">{variant.count}</span>
									</div>
									<div class="progress-bar-bg" style="height: 0.5rem; margin-top: 0;">
										<div
											class="progress-bar-fill"
											style="width: {(variant.count / word.totalCount) * 100}%; height: 0.5rem;"
										></div>
									</div>
								</div>
							{/each}
						</div>

						{#if word.variants.length > 10}
							<button type="button" class="more-link" onclick={() => (wordModalId = word.id)}>
								+ {word.variants.length - 10}
								{t.more}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-gray italic">{t.noWordsData || 'No user-entered words'}</p>
		{/if}
	</div>

	{#if modalWord}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="modal-backdrop"
			onclick={(e) => {
				if (e.target === e.currentTarget) wordModalId = null;
			}}
		>
			<div class="modal" role="dialog" aria-modal="true" aria-label={modalWord.id}>
				<div class="modal-header">
					<div>
						<h3 style="margin-bottom: 0;">{modalWord.id}</h3>
						<p class="text-sm text-gray">
							{t.totalEntries}:
							<span class="font-bold text-blue">{modalWord.totalCount}</span>
						</p>
					</div>
					<button
						type="button"
						class="modal-close"
						aria-label={t.close}
						onclick={() => (wordModalId = null)}>&times;</button
					>
				</div>
				<div class="modal-body">
					{#each modalWord.variants as variant}
						<div>
							<div class="modal-variant-row">
								<span class="break-words" style="font-weight: 500;">"{variant.replaceText}"</span>
								<span class="text-gray">{variant.count}</span>
							</div>
							<div class="progress-bar-bg" style="height: 0.5rem; margin-top: 0;">
								<div
									class="progress-bar-fill"
									style="width: {(variant.count / modalWord.totalCount) * 100}%; height: 0.5rem;"
								></div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<!-- Item Quantities -->
	<h2 id="repeated-choices">{t.repeatedChoices}</h2>
	<div class="multiple-use-container">
		{#if itemQuantityStats.length > 0}
			<p class="text-sm text-gray" style="margin-bottom: 0.75rem;">{t.itemQuantitiesHint}</p>
			<div class="quantity-legend">
				{#each QUANTITY_BINS as bin}
					<span><i style="background: {bin.color}"></i>{bin.label}</span>
				{/each}
			</div>
			<div class="quantity-table-wrapper">
				<table class="quantity-table">
					<thead>
						<tr>
							<th>{t.item}</th>
							<th>
								<button
									class:active={quantitySort === 'users'}
									onclick={() => (quantitySort = 'users')}>{t.takenBy}</button
								>
							</th>
							<th>
								<button class:active={quantitySort === 'avg'} onclick={() => (quantitySort = 'avg')}
									>{t.avgQuantity}</button
								>
							</th>
							<th>
								<button class:active={quantitySort === 'max'} onclick={() => (quantitySort = 'max')}
									>{t.maxQuantity}</button
								>
							</th>
							<th>
								<button
									class:active={quantitySort === 'units'}
									onclick={() => (quantitySort = 'units')}>{t.totalUnits}</button
								>
							</th>
							<th>
								<button
									class:active={quantitySort === 'multi'}
									onclick={() => (quantitySort = 'multi')}>{t.tookMoreThanOne}</button
								>
							</th>
							<th>{t.quantitySplit}</th>
						</tr>
					</thead>
					<tbody>
						{#each itemQuantityStats as item (item.id)}
							{@const obj = objectMap[item.id]}
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
							<tr class="clickable-row" onclick={() => (quantityModalId = item.id)}>
								<td>
									<button type="button" class="item-cell item-button">
										{#if obj && obj.image}
											<img
												src={obj.image.startsWith('http') || obj.image.startsWith('data:')
													? obj.image
													: original_url + obj.image}
												alt={obj.title}
												class="choice-image"
											/>
										{/if}
										<span class="break-words">{obj ? obj.title || item.id : item.id}</span>
									</button>
								</td>
								<td>{item.users} <span class="text-gray">({item.adoption.toFixed(1)}%)</span></td>
								<td
									>{item.avg.toFixed(1)}
									<span class="text-gray">({t.median} {item.median})</span></td
								>
								<td>{item.max}</td>
								<td>{item.units}</td>
								<td>{item.multi.toFixed(0)}%</td>
								<td class="split-cell">
									<div class="stacked-bar">
										{#each item.bins as bin}
											{#if bin.count > 0}
												<div
													style="width: {(bin.count / item.users) * 100}%; background: {bin.color}"
													title="{bin.label}x: {bin.count} ({(
														(bin.count / item.users) *
														100
													).toFixed(0)}%)"
												></div>
											{/if}
										{/each}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-gray italic">{t.noMultipleUseData}</p>
		{/if}
	</div>

	{#if modalItem}
		{@const obj = objectMap[modalItem.id]}
		{@const maxUsers = Math.max(...modalItem.distribution.map((d) => d.users), 1)}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="modal-backdrop"
			onclick={(e) => {
				if (e.target === e.currentTarget) quantityModalId = null;
			}}
		>
			<div class="modal" role="dialog" aria-modal="true" aria-label={modalItem.id}>
				<div class="modal-header">
					<div>
						<h3 style="margin-bottom: 0;">{obj ? obj.title || modalItem.id : modalItem.id}</h3>
						<p class="text-sm text-gray">
							{t.takenBy}: <span class="font-bold text-blue">{modalItem.users}</span>
							· {t.avgQuantity}: {modalItem.avg.toFixed(1)}
							· {t.median}: {modalItem.median}
							· {t.maxQuantity}: {modalItem.max}
						</p>
					</div>
					<button
						type="button"
						class="modal-close"
						aria-label={t.close}
						onclick={() => (quantityModalId = null)}>&times;</button
					>
				</div>
				<div class="modal-body">
					<p class="text-sm text-gray" style="font-weight: 600;">{t.quantitySplit}</p>
					{#each modalItem.distribution as d (d.quantity)}
						{@const bin = QUANTITY_BINS.find((b) => b.test(d.quantity))}
						<div class="distribution-row">
							<span class="distribution-label">{d.quantity}x</span>
							<div class="distribution-track">
								<div
									class="distribution-fill"
									style="width: {(d.users / maxUsers) * 100}%; background: {bin?.color ??
										'#3b82f6'}"
								></div>
							</div>
							<span class="distribution-value">
								{d.users}
								<span class="text-gray">({((d.users / modalItem.users) * 100).toFixed(1)}%)</span>
							</span>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<!-- Exit Analysis -->
	<h2 id="exit-analysis">{t.exitPointAnalysis}</h2>
	<div class="rows-container">
		{#if exitRowStats.length > 0}
			{#each exitRowStats as row}
				<div class="row-card">
					<div class="row-item-header">
						<span class="row-item-title font-bold">{row.title}</span>
						<span class="row-item-percent">{row.count} {t.users} ({row.percent.toFixed(1)}%)</span>
					</div>
					<div class="progress-bar-bg">
						<div class="progress-bar-fill" style="width: {row.percent}%"></div>
					</div>
				</div>
			{/each}
		{:else}
			<p class="text-gray italic">{t.noExitData}</p>
		{/if}
	</div>

	<!-- Row Analysis -->
	{#if projectData}
		<h2 id="row-analysis">{t.rowAnalysis}</h2>
		<div class="rows-container">
			{#each rowStatistics as row}
				{@const colors = [
					'#3b82f6',
					'#ef4444',
					'#22c55e',
					'#eab308',
					'#a855f7',
					'#ec4899',
					'#6366f1',
					'#14b8a6',
					'#f97316',
					'#8b5cf6'
				]}
				<div class="row-card">
					<h3>
						{row.title || row.id}
						<span class="text-sm text-gray">({row.totalSelections} {t.selections})</span>
					</h3>

					<!-- Stacked Bar Chart -->
					<div class="stacked-bar-container">
						<div class="stacked-bar">
							{#each row.objectStats as obj, i}
								{#if obj.percentInRow > 0}
									<div
										class="stacked-segment"
										style="width: {obj.percentInRow}%; background-color: {colors[
											i % colors.length
										]}"
										title="{obj.title || obj.id}: {obj.count} ({obj.percentInRow.toFixed(1)}%)"
									></div>
								{/if}
							{/each}
						</div>
					</div>

					<!-- Legend -->
					<div class="row-legend">
						{#each row.objectStats as obj, i}
							{#if obj.percentInRow > 0}
								<div class="legend-item">
									<span class="color-box" style="background-color: {colors[i % colors.length]}"
									></span>
									<span class="legend-label">{obj.title || obj.id}</span>
									<span class="legend-value">{obj.percentInRow.toFixed(1)}%</span>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/each}
		</div>

		<h2 id="object-stats">{t.objectStats}</h2>
		<div class="grid">
			{#each Object.entries(statisticsCounts).sort(([, a], [, b]) => b - a) as [id, count]}
				{@const obj = objectMap[id]}
				<div class="card">
					{#if obj}
						{#if obj.image}
							<img
								src={obj.image.startsWith('http') || obj.image.startsWith('data:')
									? obj.image
									: `${original_url}${obj.image}`}
								alt={obj.title}
							/>
						{/if}
						<h3>{obj.title || id}</h3>
						{#if obj.text}
							<p class="text-sm text-gray">{obj.text}</p>
						{/if}
					{:else}
						<h3>{id}</h3>
						<p class="text-sm text-gray italic">{t.objectDataNotFound}</p>
					{/if}
					<div class="card-footer">
						<span class="text-gray text-sm">{t.count}</span>
						<span class="text-xl font-bold text-blue">{count}</span>
					</div>
					<div class="progress-bar-bg">
						<div
							class="progress-bar-fill"
							style="width: {(count / filteredLogData.length) * 100}%"
						></div>
					</div>
					<p class="text-xs text-right text-gray mt-1">
						{((count / filteredLogData.length) * 100).toFixed(1)}%
					</p>
				</div>
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<p class="text-gray mb-2">{t.projectDataNotLoaded}</p>
			<p class="text-sm text-gray">
				{t.clickUpdateProject}
			</p>
		</div>
	{/if}
</div>

<style>
	h1,
	h2,
	h3 {
		margin-bottom: 10px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 1rem;
	}
	.card {
		background-color: white;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		padding: 1rem;
		box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
		display: flex;
		flex-direction: column;
	}
	.card img {
		width: 100%;
		height: 100px;
		object-fit: cover;
		border-radius: 0.25rem;
		margin-bottom: 0.5rem;
	}
	.card-footer {
		margin-top: auto;
		padding-top: 0.5rem;
		border-top: 1px solid #f3f4f6;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.progress-bar-bg {
		width: 100%;
		background-color: #e5e7eb;
		border-radius: 9999px;
		height: 0.625rem;
		margin-top: 0.5rem;
	}
	.progress-bar-fill {
		background-color: #2563eb;
		height: 0.625rem;
		border-radius: 9999px;
	}
	.text-sm {
		font-size: 0.875rem;
	}
	.text-xs {
		font-size: 0.75rem;
	}
	.text-gray {
		color: #6b7280;
	}
	.text-blue {
		color: #2563eb;
	}
	.font-bold {
		font-weight: bold;
	}
	.italic {
		font-style: italic;
	}
	.text-right {
		text-align: right;
	}
	.empty-state {
		background-color: #f3f4f6;
		padding: 1.5rem;
		border-radius: 0.5rem;
		text-align: center;
	}
	pre {
		white-space: pre-wrap;
		word-wrap: break-word;
	}
	.toc {
		background-color: #f3f4f6;
		padding: 1rem;
		border-radius: 0.5rem;
		margin-bottom: 2rem;
	}
	.toc ul {
		list-style: none;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.toc a {
		text-decoration: none;
		color: #2563eb;
		font-weight: bold;
	}
	.controls-section {
		background-color: #fff;
		border: 1px solid #e5e7eb;
		padding: 1rem;
		border-radius: 0.5rem;
		margin-bottom: 2rem;
	}
	.filters {
		display: flex;
		gap: 2rem;
		align-items: center;
		margin-top: 1rem;
		flex-wrap: wrap;
	}
	.select-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.select-group label {
		font-size: 0.875rem;
		font-weight: bold;
		color: #374151;
	}
	select {
		padding: 0.5rem;
		border: 1px solid #d1d5db;
		border-radius: 0.375rem;
		background-color: white;
		font-size: 0.875rem;
		color: #111827;
		cursor: pointer;
		min-width: 150px;
	}
	select:focus {
		outline: none;
		border-color: #3b82f6;
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
	}
	.toggle {
		display: flex;
		align-items: center;
		cursor: pointer;
	}
	.toggle input {
		display: none;
	}
	.slider {
		width: 40px;
		height: 20px;
		background-color: #ccc;
		border-radius: 20px;
		position: relative;
		margin-right: 10px;
		transition: 0.3s;
	}
	.slider::before {
		content: '';
		position: absolute;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background-color: white;
		top: 2px;
		left: 2px;
		transition: 0.3s;
	}
	.toggle input:checked + .slider {
		background-color: #2563eb;
	}
	.toggle input:checked + .slider::before {
		transform: translateX(20px);
	}
	.inline-toggle {
		display: inline-flex;
		margin-left: 1rem;
		vertical-align: middle;
	}
	.slider.small {
		width: 30px;
		height: 16px;
	}
	.slider.small::before {
		width: 12px;
		height: 12px;
	}
	.toggle input:checked + .slider.small::before {
		transform: translateX(14px);
	}
	.font-normal {
		font-weight: normal;
	}
	.chart-container {
		background-color: white;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		padding: 1rem;
		margin-bottom: 2rem;
	}
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}
	.stat-card {
		background-color: white;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		padding: 1rem;
		text-align: center;
	}
	.stat-card.wide {
		grid-column: span 2;
		text-align: left;
	}
	.stat-value {
		font-size: 2rem;
		font-weight: bold;
		color: #2563eb;
	}
	.rows-container {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 2rem;
	}
	.row-card {
		background-color: white;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		padding: 1rem;
	}
	.row-item-header {
		display: flex;
		justify-content: space-between;
		font-size: 0.875rem;
		margin-bottom: 0.25rem;
	}
	:global(html) {
		scroll-behavior: smooth;
	}
	.chart-legend {
		display: flex;
		justify-content: center;
		gap: 2rem;
		margin-top: 1rem;
	}
	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: #666;
	}
	.color-box {
		width: 1rem;
		height: 1rem;
		display: inline-block;
	}
	.color-box.bar {
		background-color: #3b82f6;
		opacity: 0.6;
	}
	.color-box.line {
		background-color: #ef4444;
		height: 2px;
		margin-top: 0.4rem;
	}
	.percentile-row {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}
	.percentile-card {
		display: flex;
		flex-direction: column;
		padding: 0.5rem 1rem;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		min-width: 80px;
	}
	.meta-label {
		font-size: 0.75rem;
		color: #6b7280;
	}
	.meta-value {
		font-size: 1.25rem;
		font-weight: bold;
		color: #2563eb;
	}
	.retention-chart {
		width: 100%;
		max-width: 720px;
		height: auto;
	}
	.retention-chart .grid-line {
		stroke: #e5e7eb;
		stroke-width: 1;
	}
	.retention-chart .axis-text {
		font-size: 11px;
		fill: #6b7280;
	}
	.retention-chart .curve-line {
		fill: none;
		stroke: #2563eb;
		stroke-width: 2;
	}
	.retention-chart .curve-area {
		fill: rgba(59, 130, 246, 0.15);
	}
	.ml-2 {
		margin-left: 0.5rem;
	}
	.pie-chart-container {
		display: flex;
		align-items: center;
		gap: 2rem;
		justify-content: center;
	}
	.pie-chart {
		width: 150px;
		height: 150px;
		flex-shrink: 0;
	}
	.pie-legend {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.legend-label {
		font-weight: bold;
		margin-right: 0.5rem;
	}
	.legend-value {
		color: #6b7280;
	}
	.stacked-bar-container {
		margin-bottom: 1rem;
	}
	.stacked-bar {
		display: flex;
		height: 1.5rem;
		width: 100%;
		background-color: #e5e7eb;
		border-radius: 0.25rem;
		overflow: hidden;
	}
	.stacked-segment {
		height: 100%;
		transition: width 0.3s ease;
	}
	.stacked-segment:hover {
		opacity: 0.8;
	}
	.row-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.words-container {
		margin-bottom: 2rem;
	}
	.multiple-use-container {
		margin-bottom: 2rem;
	}
	.quantity-legend {
		display: flex;
		gap: 1rem;
		font-size: 0.75rem;
		color: #6b7280;
		margin-bottom: 0.5rem;
	}
	.quantity-legend i {
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 2px;
		margin-right: 0.25rem;
		vertical-align: middle;
	}
	.quantity-table-wrapper {
		overflow-x: auto;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
	}
	.quantity-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}
	.quantity-table th,
	.quantity-table td {
		padding: 0.5rem 0.75rem;
		text-align: left;
		border-bottom: 1px solid #f3f4f6;
		white-space: nowrap;
	}
	.quantity-table th button {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: #6b7280;
		cursor: pointer;
	}
	.quantity-table th button.active {
		color: #2563eb;
	}
	.quantity-table th button.active::after {
		content: ' ↓';
	}
	.item-cell {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		white-space: normal;
		min-width: 180px;
	}
	.choice-image {
		width: 40px;
		height: 40px;
		object-fit: cover;
		border-radius: 0.25rem;
		flex-shrink: 0;
	}
	.split-cell {
		min-width: 160px;
		width: 30%;
	}
	.stacked-bar {
		display: flex;
		height: 1rem;
		border-radius: 0.25rem;
		overflow: hidden;
		background: #f3f4f6;
	}
	.card-content {
		background-color: #f9fafb;
		padding: 0.5rem;
		border-radius: 0.25rem;
		margin: 0.5rem 0;
	}
	.break-words {
		word-break: break-word;
		white-space: normal;
	}
	.mt-2 {
		margin-top: 0.5rem;
	}
	.more-link {
		display: block;
		margin: 0.5rem auto 0;
		padding: 0.25rem 0.5rem;
		background: none;
		border: none;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		color: #2563eb;
		cursor: pointer;
		text-decoration: underline;
	}
	.more-link:hover {
		background-color: #eff6ff;
	}
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background-color: rgba(0, 0, 0, 0.5);
	}
	.modal {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 32rem;
		max-height: 80vh;
		background-color: white;
		border-radius: 0.5rem;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
	}
	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		padding: 1rem;
		border-bottom: 1px solid #e5e7eb;
	}
	.modal-close {
		background: none;
		border: none;
		font-size: 1.75rem;
		line-height: 1;
		color: #6b7280;
		cursor: pointer;
	}
	.modal-close:hover {
		color: #111827;
	}
	.modal-body {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem;
		overflow-y: auto;
	}
	.clickable-row {
		cursor: pointer;
	}
	.clickable-row:hover {
		background-color: #f9fafb;
	}
	.item-button {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		text-align: left;
		cursor: pointer;
		color: inherit;
	}
	.clickable-row:hover .item-button span {
		text-decoration: underline;
	}
	.distribution-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.875rem;
	}
	.distribution-label {
		min-width: 3rem;
		text-align: right;
		font-weight: 500;
	}
	.distribution-track {
		flex: 1;
		height: 0.75rem;
		background-color: #f3f4f6;
		border-radius: 9999px;
		overflow: hidden;
	}
	.distribution-fill {
		height: 100%;
		border-radius: 9999px;
	}
	.distribution-value {
		min-width: 6rem;
		white-space: nowrap;
	}
	.modal-variant-row {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-size: 0.875rem;
		margin-bottom: 0.125rem;
	}
</style>
