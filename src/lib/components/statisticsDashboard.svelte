<script lang="ts">
	import { translations } from '$lib/translations';
	import { ProcessingData } from '$lib/utils';
	import type { LogEntry, correlationObject } from '$lib/types';

	// 1. Svelte 5 Props
	let { logData = [], projectData = null, progressMessage = '', currentLang = 'en' } = $props();

	// 2. State (UI Controls)
	let uniqueUsersOnly = $state(false);
	let timeRange = $state('all'); // 'all', '24h', '7d', '30d'
	let timeUnit = $state('day'); // 'day', 'hour', 'week'
	let selectedFilterChoice = $state('');
	let selectedFilterChoiceCount = $state(3);
	let isLogarithmicTime = $state(false);

	let enableCorrelation = $state(false);
	let correlationLimit = $state(10);

	// Correlation Sorting Function State
	const correlationSortOptions = [
		{
			label: 'Log-Weighted Lift (Balanced Heuristic)',
			value: (a: correlationObject, b: correlationObject) =>
				calcLogWeightedLift(b) - calcLogWeightedLift(a)
		},
		{
			label: 'Jaccard Index (Intersection over Union)',
			value: (a: correlationObject, b: correlationObject) => calcJaccard(b) - calcJaccard(a)
		},
		{
			label: 'Cosine Similarity',
			value: (a: correlationObject, b: correlationObject) => calcCosine(b) - calcCosine(a)
		},
		{
			label: 'Frequency-weighted Lift',
			value: (a: correlationObject, b: correlationObject) => b.lift * b.count - a.lift * a.count
		},
		{
			label: 'Lift (Basic Probability Ratio)',
			value: (a: correlationObject, b: correlationObject) => b.lift - a.lift
		},
		{
			label: 'Co-Occurrence Percentage',
			value: (a: correlationObject, b: correlationObject) => b.percent - a.percent
		},
		{
			label: 'Co-Occurrence Count',
			value: (a: correlationObject, b: correlationObject) => b.count - a.count
		}
	];
	let correlationSortFunction = $state(correlationSortOptions[0].value);

	// 3. Derived Helpers
	let t = $derived(translations[currentLang as keyof typeof translations] || translations['en']);
	let original_url = $derived(
		logData.length > 0 && logData[0].current_url ? logData[0].current_url : ''
	);

	// =================================================================================================
	// 4. DATA PROCESSING PIPELINE (Optimized)
	// =================================================================================================

	// Step A: Parse JSON once ($derived automatically caches this)
	// This prevents JSON.parse from running thousands of times during renders.
	let parsedLogData: LogEntry[] = $derived(
		logData.map((entry) => {
			let d: any = {};
			try {
				d = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;

				// Optimization: Pre-sort choices once here to avoid sorting in the O(N) loop later
				if (d?.selectedChoices?.length) {
					// Copy to avoid mutating original if it was passed as object
					d.selectedChoices = [...d.selectedChoices].sort();
				}
			} catch (e) {
				/* ignore */
			}

			return {
				...entry,
				data: null, // Free up memory
				parsedData: d, // Store parsed data
				timestamp: new Date(entry.created_at).getTime() // Store numeric timestamp for fast filtering
			};
		})
	);

	// Step B: Apply Filters (Time, Unique User, Choice)
	let filteredLogData = $derived.by(() => {
		// console.log('(B) Applying filters to log data...');
		console.time('(B) Applying filters to log data...');
		let data = parsedLogData;

		// 1. Time Filter (Numeric comparison is faster)
		if (timeRange !== 'all') {
			const now = Date.now();
			let cutoff = now;
			if (timeRange === '24h') cutoff -= 24 * 60 * 60 * 1000;
			if (timeRange === '7d') cutoff -= 7 * 24 * 60 * 60 * 1000;
			if (timeRange === '30d') cutoff -= 30 * 24 * 60 * 60 * 1000;
			data = data.filter((e) => e.timestamp ?? 0 >= cutoff);
		}

		// 2. Unique Users
		if (uniqueUsersOnly) {
			const latestEntries = new Map();
			let uidSet = new Set();
			for (const entry of data) {
				if (!uidSet.has(entry.uid)) {
					latestEntries.set(entry.uid, entry);
					uidSet.add(entry.uid);
				}
			}
			data = Array.from(latestEntries.values());
		}

		// 3. Filter by Choice
		if (selectedFilterChoice != '') {
			data = data.filter(
				(entry) =>
					entry.parsedData.selectedChoices &&
					entry.parsedData.selectedChoices.includes(selectedFilterChoice)
			);
		}

		if (selectedFilterChoiceCount > 0) {
			data = data.filter(
				(entry) =>
					entry.parsedData.selectedChoices &&
					entry.parsedData.selectedChoices.length >= selectedFilterChoiceCount
			);
		}

		console.timeEnd('(B) Applying filters to log data...');
		return data;
	});

	// Step C: Global Choice Counts (Lookup Table)
	let statisticsCounts = $derived.by(() => {
		console.time('(C) Calculating global statistics counts...');
		const counts: Record<string, number> = {};
		for (const entry of filteredLogData) {
			const choices = entry.parsedData.selectedChoices;
			if (Array.isArray(choices)) {
				for (const id of choices) {
					counts[id] = (counts[id] || 0) + 1;
				}
			}
		}
		console.timeEnd('(C) Calculating global statistics counts...');
		return counts;
	});

	// Step D: Object Map for Title/Image Lookups
	let objectMap = $derived.by(() => {
		console.time('(D) Building object map...');
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
		console.timeEnd('(D) Building object map...');
		return map;
	});

	// Step E: Object ID to Row ID Map
	let objectToRowMap = $derived.by(() => {
		console.time('(E) Building object to row map...');
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
		console.timeEnd('(E) Building object to row map...');
		return map;
	});

	// =================================================================================================
	// 5. STATISTICS CALCULATION BLOCKS
	// =================================================================================================

	// --- 1. Visitor Graph ---
	let visitorGraphData = $derived.by(() => {
		console.time('(1) Visitor Graph Calculation Time');
		const groupedData: Record<string, number> = {};

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
			groupedData[key] = (groupedData[key] || 0) + 1;
		}

		let sorted = Object.entries(groupedData)
			.map(([dateStr, count]) => {
				const date = new Date(dateStr);
				let label = '';
				if (timeUnit === 'hour')
					label = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
				else label = `${date.getMonth() + 1}/${date.getDate()}`;

				return { date: dateStr, count, timestamp: date.getTime(), label, accumulated: 0 };
			})
			.sort((a, b) => a.timestamp - b.timestamp);

		let sum = 0;
		console.timeEnd('(1) Visitor Graph Calculation Time');
		return sorted.map((item) => {
			sum += item.count;
			return { ...item, accumulated: sum };
		});
	});

	// --- 2. General Stats & Time Distribution ---
	let generalData = $derived.by(() => {
		console.time('(2) General Stats Calculation Time');
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

		// Distribution Buckets
		let distribution: { label: string; count: number; percent: number }[] = [];
		if (times.length > 0) {
			if (isLogarithmicTime) {
				const buckets = { '< 10s': 0, '10s - 1m': 0, '1m - 10m': 0, '10m - 1h': 0, '> 1h': 0 };
				for (const t of times) {
					if (t < 10) buckets['< 10s']++;
					else if (t < 60) buckets['10s - 1m']++;
					else if (t < 600) buckets['1m - 10m']++;
					else if (t < 3600) buckets['10m - 1h']++;
					else buckets['> 1h']++;
				}
				distribution = Object.entries(buckets).map(([label, count]) => ({
					label,
					count,
					percent: (count / times.length) * 100
				}));
			} else {
				const p95Index = Math.floor(times.length * 0.95);
				const p95 = times[p95Index] || times[times.length - 1];
				const maxVal = Math.max(p95, 60);
				const bucketCount = 10;
				const bucketSize = maxVal / bucketCount;

				const bucketMap: Record<string, number> = {};
				const labels: string[] = [];

				for (let i = 0; i < bucketCount; i++) {
					const start = Math.round(i * bucketSize);
					const end = Math.round((i + 1) * bucketSize);
					const label = `${formatTime(start)}-${formatTime(end)}`;
					bucketMap[label] = 0;
					labels.push(label);
				}
				const overflow = `> ${formatTime(Math.round(maxVal))}`;
				bucketMap[overflow] = 0;
				labels.push(overflow);

				for (const t of times) {
					if (t >= maxVal) bucketMap[overflow]++;
					else {
						const idx = Math.min(Math.floor(t / bucketSize), bucketCount - 1);
						bucketMap[labels[idx]]++;
					}
				}
				distribution = labels.map((label) => ({
					label,
					count: bucketMap[label],
					percent: (bucketMap[label] / times.length) * 100
				}));
			}
		}

		console.timeEnd('(2) General Stats Calculation Time');
		return { stats, distribution };
	});

	let generalStats = $derived(generalData.stats);
	let timeDistribution = $derived(generalData.distribution);

	// --- 3. Correlations (Optimized) ---
	let topCorrelations = $derived.by(() => {
		if (!enableCorrelation) return [];
		if (projectData == null) return [];
		if (filteredLogData.length === 0) return [];

		console.time('(3-1) Correlations Calculation Time');
		const pairCounts = new Map<string, number>();
		const totalEntries = filteredLogData.length;

		for (const entry of filteredLogData) {
			const choices = entry.parsedData.selectedChoices;
			if (!choices || choices.length < 2) continue;

			// Choices are already sorted in parsedLogData (Step A)
			const len = choices.length;

			// O(Choices^2) per user, but O(N * C^2) total.
			for (let i = 0; i < len; i++) {
				const choiceA = choices[i];
				for (let j = i + 1; j < len; j++) {
					const key = `${choiceA}|${choices[j]}`;
					pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
				}
			}
		}

		const correlations = Array.from(pairCounts.entries()).map(([key, count]) => {
			const [idA, idB] = key.split('|');
			const countA = statisticsCounts[idA] || 0;
			const countB = statisticsCounts[idB] || 0;

			const percent = (count / totalEntries) * 100;
			const probA = countA / totalEntries;
			const probB = countB / totalEntries;
			const lift = probA * probB > 0 ? percent / 100 / (probA * probB) : 0;

			return { idA, idB, count, percent, probA, probB, lift };
		});
		console.timeEnd('(3-1) Correlations Calculation Time');
		return correlations;
	});

	let sortedTopCorrelations = $derived.by(() => {
		console.time('(3-2) Correlation Sorting Time');

		// Create a copy to make sure it's reactive
		const correlationsCopy = [...topCorrelations];
		const sorted = correlationsCopy.sort(correlationSortFunction);
		console.timeEnd('(3-2) Correlation Sorting Time');
		return sorted;
	});

	let slicedSortedTopCorrelations = $derived.by(() => {
		console.time('(3-3) Correlation Slicing Time');

		const sliced = sortedTopCorrelations.slice(0, correlationLimit);
		console.timeEnd('(3-3) Correlation Slicing Time');
		return sliced;
	});

	// --- 4. Row Statistics (Heavily Optimized) ---
	let rowStatistics = $derived.by(() => {
		if (!projectData?.rows) return [];
		console.time('(4) Row Statistics Calculation Time');

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
		console.timeEnd('(4) Row Statistics Calculation Time');
		return result;
	});

	// --- 5. Exit Statistics ---
	let exitRowStats = $derived.by(() => {
		// console.log('(5) Calculating exit row statistics...');
		if (filteredLogData.length === 0 || Object.keys(objectToRowMap).length === 0) return [];
		console.time('(5) Exit Row Statistics Calculation Time');

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

		console.timeEnd('(5) Exit Row Statistics Calculation Time');
		return result;
	});

	interface Word {
		id: string;
		replaceText: string;
	}
	// --- 6. User Words (Moved out of HTML) ---
	let wordStatistics = $derived.by(() => {
		console.time('(6) User Word Statistics Calculation Time');
		const wordStat: Record<string, Record<string, number>> = {};

		for (const entry of filteredLogData) {
			const words = entry.parsedData.words as Word[];
			if (words && Array.isArray(words)) {
				for (const word of words) {
					if (word.replaceText == null) continue;
					if (word.replaceText.trim() === '') word.replaceText = '(empty)';
					word.replaceText = word.replaceText.trim();

					// Register word occurrence
					if (!wordStat[word.id]) {
						wordStat[word.id] = { [`${word.replaceText}`]: 1 };
						continue;
					}

					const wordObj = wordStat[word.id];
					// Register replaceText occurrence
					if (!wordObj[word.replaceText]) {
						wordObj[word.replaceText] = 1;
						continue;
					}

					wordObj[word.replaceText] += 1;
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

		console.timeEnd('(6) User Word Statistics Calculation Time');
		console.log('Word Statistics:', result);
		return result;
	});

	// --- 7. Repeated Choices (Moved out of HTML) ---
	let repeatedChoiceStats = $derived.by(() => {
		// console.log('(7) Calculating repeated choice statistics...');
		console.time('(7) Repeated Choice Statistics Calculation Time');

		const multiMap: Record<string, any> = {};
		for (const entry of filteredLogData) {
			const vars = entry.parsedData.multipleUseVariable;
			if (vars && Array.isArray(vars)) {
				for (const item of vars) {
					if (!multiMap[item.id]) {
						multiMap[item.id] = {
							id: item.id,
							totalCount: 0,
							occurrences: 0,
							distribution: {}
						};
					}
					multiMap[item.id].totalCount += item.count;
					multiMap[item.id].occurrences++;
					const k = item.count;
					multiMap[item.id].distribution[k] = (multiMap[item.id].distribution[k] || 0) + 1;
				}
			}
		}
		const result = Object.values(multiMap).sort((a: any, b: any) => b.totalCount - a.totalCount);
		console.timeEnd('(7) Repeated Choice Statistics Calculation Time');
		return result;
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

	// Correlation Helper Functions
	const getProbAB = (obj: correlationObject) => obj.percent / 100;

	const calcJaccard = (obj: correlationObject) => {
		const pAB = getProbAB(obj);
		const union = obj.probA + obj.probB - pAB;
		return union <= 0 ? 0 : pAB / union;
	};
	const calcCosine = (obj: correlationObject) => {
		const pAB = getProbAB(obj);
		const denom = Math.sqrt(obj.probA * obj.probB);
		return denom <= 0 ? 0 : pAB / denom;
	};
	const calcLogWeightedLift = (obj: correlationObject) => {
		return obj.lift * Math.log(obj.count + 1);
	};
</script>

<div>
	<!-- Table of Contents -->
	<div class="toc">
		<h3>{t.toc}</h3>
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

	<h1 id="controls">{t.statisticsControls}</h1>
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
				<label for="timeUnit">{t.groupBy}</label>
				<select id="timeUnit" bind:value={timeUnit}>
					<option value="week">{t.week}</option>
					<option value="day">{t.day}</option>
					<option value="hour">{t.hour}</option>
				</select>
			</div>

			<div class="select-group">
				<label for="filterChoice">{t.filterByChoice}</label>
				<select id="filterChoice" bind:value={selectedFilterChoice}>
					<option value="">{t.allChoices}</option>
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
		</div>
	</div>

	{#if progressMessage}
		<div class="alert" role="alert">
			<p>{progressMessage}</p>
		</div>
	{/if}

	<!-- Visitor Graph -->
	<h2 id="visitor-graph">{t.visitorCount}</h2>
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
			<p class="stat-value">{filteredLogData.length}</p>
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

	<!-- Time Distribution -->
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
		{#if timeDistribution.length > 0}
			{@const maxCount = Math.max(...timeDistribution.map((d) => d.count), 1)}
			<div class="distribution-chart">
				{#each timeDistribution as d}
					<div class="dist-bar-container">
						<div class="dist-label">{d.label}</div>
						<div class="dist-bar-wrapper">
							<div
								class="dist-bar"
								style="width: {(d.count / maxCount) * 100}%"
								title="{d.count} {t.users} ({d.percent.toFixed(1)}%)"
							></div>
							<span class="dist-value">{d.count} ({d.percent.toFixed(1)}%)</span>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-gray italic">{t.noTimeData}</p>
		{/if}
	</div>

	<!-- Choice Correlations -->
	<h2 id="correlations">{t.choiceCorrelations} (top {correlationLimit})</h2>
	<select id="correlationSort" bind:value={correlationSortFunction}>
		{#each correlationSortOptions as option}
			<option value={option.value} selected={option.value == correlationSortOptions[0].value}
				>{option.label}</option
			>
		{/each}
	</select>
	<input
		type="range"
		min="1"
		max="100"
		step="1"
		bind:value={correlationLimit}
		class="number-input"
	/>
	<input type="checkbox" id="enableCorrelation" bind:checked={enableCorrelation} />
	<label for="enableCorrelation">{t.enableCorrelation}</label>
	{#if !enableCorrelation}
		<p class="text-red-600 italic">{t.correlationDisabled}</p>
	{/if}
	<div class="correlation-grid">
		{#each slicedSortedTopCorrelations as corr}
			{@const objA = objectMap[corr.idA]}
			{@const objB = objectMap[corr.idB]}
			<div class="correlation-card">
				<div class="correlation-pair">
					<span title={corr.idA}>{objA ? objA.title || corr.idA : corr.idA}</span>
					<span class="separator">+</span>
					<span title={corr.idB}>{objB ? objB.title || corr.idB : corr.idB}</span>
				</div>
				<div class="correlation-stat">
					<span class="lift">Lift: {corr.lift.toFixed(2)}</span>
					<span class="count">{corr.count}</span>
					<span class="percent">({corr.percent.toFixed(1)}%)</span>
				</div>
			</div>
		{/each}
		{#if slicedSortedTopCorrelations.length === 0}
			<p class="text-gray italic">{t.noCorrelations}</p>
		{/if}
	</div>

	<!-- User-Entered Words -->
	<h2 id="user-words">{t.userEnteredWords || 'User-Entered Words'}</h2>
	<div class="words-container">
		{#if wordStatistics.length > 0}
			<div class="grid">
				{#each wordStatistics as word}
					<div class="card">
						<h3>{word.id}</h3>
						<p class="text-sm text-gray" style="margin-bottom: 0.5rem;">
							{t.totalEntries || 'Total'}:
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
							<p class="text-xs text-gray text-center mt-2">
								+ {word.variants.length - 10}
								{t.more || 'more'}
							</p>
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-gray italic">{t.noWordsData || 'No user-entered words'}</p>
		{/if}
	</div>

	<!-- Repeated Choices -->
	<h2 id="repeated-choices">{t.repeatedChoices || 'Repeated Choices'}</h2>
	<div class="multiple-use-container">
		{#if repeatedChoiceStats.length > 0}
			<div class="repeated-choices-list">
				{#each repeatedChoiceStats as item}
					{@const obj = objectMap[item.id]}
					{@const maxDist = Math.max(...Object.values(item.distribution as Record<string, number>))}
					<div class="repeated-choice-row">
						<div class="choice-header">
							{#if obj && obj.image}
								<img
									src={obj.image.startsWith('http') || obj.image.startsWith('data:')
										? obj.image
										: original_url + obj.image}
									alt={obj.title}
									class="choice-image"
								/>
							{/if}
							<div class="choice-details">
								<h3>{obj ? obj.title || item.id : item.id}</h3>
								{#if obj && obj.text}
									<p class="text-sm text-gray">{obj.text}</p>
								{/if}
							</div>
							<div class="choice-meta">
								<div class="meta-item">
									<span class="meta-label">{t.totalSelections || 'Total Selections'}</span>
									<span class="meta-value">{item.totalCount}</span>
								</div>
								<div class="meta-item">
									<span class="meta-label">{t.users || 'Users'}</span>
									<span class="meta-value">{item.occurrences}</span>
								</div>
							</div>
						</div>
						<div class="choice-distribution">
							{#each Object.entries(item.distribution).sort((a, b) => Number(a[0]) - Number(b[0])) as [count, userCount]}
								<div class="dist-row">
									<span class="dist-label">{count}x</span>
									<div class="dist-bar-bg">
										<div
											class="dist-bar-fill"
											style="width: {(Number(userCount) / maxDist) * 100}%"
											title="{userCount} users selected this {count} times"
										></div>
									</div>
									<span class="dist-count">{userCount}</span>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-gray italic">{t.noMultipleUseData || 'No repeated choices'}</p>
		{/if}
	</div>

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
	.alert {
		background-color: #fef9c3;
		border-left: 4px solid #eab308;
		color: #a16207;
		padding: 1rem;
		margin-bottom: 1rem;
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
	#correlations {
		margin-bottom: 2rem;
	}
	#correlationSort {
		margin-bottom: 1rem;
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
	.number-input {
		width: 60px;
		padding: 0.25rem;
		border: 1px solid #d1d5db;
		border-radius: 0.375rem;
		background-color: white;
		font-size: 0.875rem;
		color: #111827;
		cursor: pointer;
		margin-left: 1rem;
	}
	.correlation-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}
	.correlation-card {
		background-color: white;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
	}
	.correlation-pair {
		font-weight: bold;
		margin-bottom: 0.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
	}
	.correlation-pair .separator {
		color: #9ca3af;
	}
	.correlation-stat {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.correlation-stat .count {
		font-size: 1.25rem;
		font-weight: bold;
		color: #2563eb;
	}
	.correlation-stat .percent {
		color: #6b7280;
		font-size: 0.875rem;
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
	.distribution-chart {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.dist-bar-container {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.dist-label {
		width: 80px;
		text-align: right;
		font-size: 0.875rem;
		color: #666;
	}
	.dist-bar-wrapper {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.dist-bar {
		height: 1.5rem;
		background-color: #3b82f6;
		border-radius: 0.25rem;
		min-width: 2px;
	}
	.dist-value {
		font-size: 0.875rem;
		color: #666;
		white-space: nowrap;
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
	.repeated-choices-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.repeated-choice-row {
		background-color: white;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.choice-header {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
	}
	.choice-image {
		width: 60px;
		height: 60px;
		object-fit: cover;
		border-radius: 0.25rem;
		flex-shrink: 0;
	}
	.choice-details {
		flex: 1;
	}
	.choice-details h3 {
		margin: 0 0 0.25rem 0;
		font-size: 1.1rem;
	}
	.choice-meta {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 120px;
		text-align: right;
	}
	.meta-item {
		display: flex;
		flex-direction: column;
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
	.choice-distribution {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding-left: 1rem;
		border-left: 2px solid #e5e7eb;
	}
	.dist-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}
	.dist-label {
		width: 30px;
		text-align: right;
		color: #6b7280;
		font-weight: 500;
	}
	.dist-bar-bg {
		flex: 1;
		height: 1.25rem;
		background-color: #f3f4f6;
		border-radius: 0.25rem;
		overflow: hidden;
	}
	.dist-bar-fill {
		height: 100%;
		background-color: #3b82f6;
		border-radius: 0.25rem;
		min-width: 2px;
	}
	.dist-count {
		width: 40px;
		color: #6b7280;
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
</style>
