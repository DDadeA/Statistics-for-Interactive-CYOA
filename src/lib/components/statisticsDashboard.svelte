<script lang="ts">
	export let logData: LogEntry[] = [];
	export let projectData: any = null;
	export let progressMessage: string = '';
	export let currentLang: string = 'en';

	import { translations } from '$lib/translations';
	import type { LogEntry } from '$lib/types';

	$: t = translations[currentLang as keyof typeof translations];

	// Options
	let uniqueUsersOnly = false;
	let timeRange = 'all'; // 'all', '24h', '7d', '30d'
	let timeUnit = 'day'; // 'day', 'hour', 'week'
	let selectedFilterChoice = '';
	let isLogarithmicTime = false;

	// Derived Data
	let filteredLogData: LogEntry[] = [];
	let visitorGraphData: { date: string; count: number; accumulated: number; label: string }[] = [];
	let rowStatistics: any[] = [];
	let generalStats: any = {};
	let timeDistribution: { label: string; count: number; percent: number }[] = [];
	let exitRowStats: { id: string; title: string; count: number; percent: number }[] = [];
	let topCorrelations: correlationObject[] = [];
	let allKnownChoices: string[] = [];
	let original_url = '';

	interface correlationObject {
		idA: string;
		idB: string;
		count: number;
		percent: number;
		probA: number;
		probB: number;
		lift: number;
	}

	let correlationSortFunction: (a: correlationObject, b: correlationObject) => number = (
		a: correlationObject,
		b: correlationObject
	) => calcLogWeightedLift(b) - calcLogWeightedLift(a);

	const getProbAB = (obj: correlationObject) => obj.percent / 100;

	const calcJaccard = (obj: correlationObject) => {
		const pAB = getProbAB(obj);
		// P(A∪B) = P(A) + P(B) - P(A∩B)
		const union = obj.probA + obj.probB - pAB;
		return union <= 0 ? 0 : pAB / union;
	};

	const calcCosine = (obj: correlationObject) => {
		const pAB = getProbAB(obj);
		const denominator = Math.sqrt(obj.probA * obj.probB);
		return denominator <= 0 ? 0 : pAB / denominator;
	};

	const calcLogWeightedLift = (obj: correlationObject) => {
		return obj.lift * Math.log(obj.count + 1);
	};

	// Reactive Statements for Data Processing
	$: {
		t; // Dependency for language switching
		let data = [...logData];
		original_url = logData.length > 0 && logData[0].current_url ? logData[0].current_url : '';

		// 1. Filter by Time Range
		const now = new Date();
		if (timeRange !== 'all') {
			const cutoff = new Date();
			if (timeRange === '24h') cutoff.setHours(now.getHours() - 24);
			if (timeRange === '7d') cutoff.setDate(now.getDate() - 7);
			if (timeRange === '30d') cutoff.setDate(now.getDate() - 30);
			data = data.filter((entry) => new Date(entry.created_at) >= cutoff);
		}

		// 2. Filter by Unique Users (Latest entry per UID)
		if (uniqueUsersOnly) {
			const latestEntries = new Map<string, LogEntry>();
			data.forEach((entry) => {
				const existing = latestEntries.get(entry.uid);
				if (
					!existing ||
					new Date(entry.created_at).getTime() > new Date(existing.created_at).getTime()
				) {
					latestEntries.set(entry.uid, entry);
				}
			});
			data = Array.from(latestEntries.values());
		}

		// 3. Filter by Specific Choice
		if (selectedFilterChoice) {
			data = data.filter((entry) => {
				try {
					const d = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
					return d.selectedChoices && d.selectedChoices.includes(selectedFilterChoice);
				} catch (e) {
					return false;
				}
			});
		}

		filteredLogData = data;

		// 4. Visitor Graph Data
		const groupedData: Record<string, number> = {};

		data.forEach((entry) => {
			const date = new Date(entry.created_at);
			let key = '';
			let label = '';
			if (timeUnit === 'hour') {
				// Round down to hour
				date.setMinutes(0, 0, 0);
				key = date.toISOString();
				label = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
			} else if (timeUnit === 'week') {
				// Round down to start of week (Monday)
				const day = date.getDay();
				const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
				date.setDate(diff);
				date.setHours(0, 0, 0, 0);
				key = date.toISOString();
				label = `${date.getMonth() + 1}/${date.getDate()}`;
			} else {
				// Round down to day
				date.setHours(0, 0, 0, 0);
				key = date.toISOString();
				label = `${date.getMonth() + 1}/${date.getDate()}`;
			}
			groupedData[key] = (groupedData[key] || 0) + 1;
		});

		let graphData = Object.entries(groupedData)
			.map(([dateStr, count]) => {
				const date = new Date(dateStr);
				let label = '';
				if (timeUnit === 'hour') {
					label = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
				} else if (timeUnit === 'week') {
					label = `${date.getMonth() + 1}/${date.getDate()}`;
				} else {
					label = `${date.getMonth() + 1}/${date.getDate()}`;
				}
				return {
					date: dateStr,
					count: count,
					timestamp: date.getTime(),
					label: label,
					accumulated: 0
				};
			})
			.sort((a, b) => a.timestamp - b.timestamp);

		let sum = 0;
		graphData = graphData.map((item) => {
			sum += item.count;
			return { ...item, accumulated: sum };
		});

		visitorGraphData = graphData;

		// 5. General Stats & Time Distribution
		let totalTime = 0;
		let timeCount = 0;
		const viewports: Record<string, number> = {};
		const times: number[] = [];

		let totalViewportCount = 0;
		data.forEach((entry) => {
			try {
				const d = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
				if (d.timeOnPage) {
					totalTime += d.timeOnPage;
					timeCount++;
					times.push(d.timeOnPage / 1000); // seconds
				}
				if (d.viewportSize) {
					// Group by width to avoid fragmentation due to browser height differences
					let key = d.viewportSize;
					const parts = d.viewportSize.split('x');
					if (parts.length === 2) {
						key = `${parts[0]}px (Width)`;
					}
					viewports[key] = (viewports[key] || 0) + 1;
					totalViewportCount++;
				}
			} catch (e) {}
		});

		generalStats = {
			avgTimeOnPage: timeCount > 0 ? Math.round(totalTime / timeCount / 1000) : 0, // seconds
			totalTimeOnPage: Math.round(totalTime / 1000), // seconds
			topViewports: Object.entries(viewports)
				.sort(([, a], [, b]) => b - a)
				.slice(0, 5),
			totalViewportCount
		};

		if (times.length > 0) {
			// Calculate Median
			times.sort((a, b) => a - b);
			let median = 0;
			const mid = Math.floor(times.length / 2);
			if (times.length % 2 === 0) {
				median = (times[mid - 1] + times[mid]) / 2;
			} else {
				median = times[mid];
			}
			generalStats.medianTimeOnPage = Math.round(median);

			if (isLogarithmicTime) {
				// Logarithmic Buckets
				const buckets = {
					'< 10s': 0,
					'10s - 1m': 0,
					'1m - 10m': 0,
					'10m - 1h': 0,
					'> 1h': 0
				};
				times.forEach((t) => {
					if (t < 10) buckets['< 10s']++;
					else if (t < 60) buckets['10s - 1m']++;
					else if (t < 600) buckets['1m - 10m']++;
					else if (t < 3600) buckets['10m - 1h']++;
					else buckets['> 1h']++;
				});
				timeDistribution = Object.entries(buckets).map(([label, count]) => ({
					label,
					count,
					percent: (count / times.length) * 100
				}));
			} else {
				// Linear Adaptive Buckets (Smart Adaptive)
				// times is already sorted
				const p95Index = Math.floor(times.length * 0.95);
				const p95 = times[p95Index] || times[times.length - 1];

				// Avoid creating too many small buckets if p95 is small
				const maxVal = Math.max(p95, 60); // Minimum 60s range
				const bucketCount = 10;
				const bucketSize = maxVal / bucketCount;

				const buckets: Record<string, number> = {};
				const bucketLabels: string[] = [];

				// Initialize buckets
				for (let i = 0; i < bucketCount; i++) {
					const start = Math.round(i * bucketSize);
					const end = Math.round((i + 1) * bucketSize);
					const label = `${formatTime(start)}-${formatTime(end)}`;
					buckets[label] = 0;
					bucketLabels.push(label);
				}
				const overflowLabel = `> ${formatTime(Math.round(maxVal))}`;
				buckets[overflowLabel] = 0;
				bucketLabels.push(overflowLabel);

				times.forEach((t) => {
					if (t >= maxVal) {
						buckets[overflowLabel]++;
					} else {
						const index = Math.floor(t / bucketSize);
						const safeIndex = Math.min(index, bucketCount - 1);
						buckets[bucketLabels[safeIndex]]++;
					}
				});

				timeDistribution = bucketLabels.map((label) => ({
					label,
					count: buckets[label],
					percent: (buckets[label] / times.length) * 100
				}));
			}
		} else {
			timeDistribution = [];
		}

		// 6. Correlations
		if (filteredLogData.length > 0) {
			const individualChoiceCounts: Record<string, number> = {};
			const pairCounts: Record<string, number> = {};
			let totalEntries = filteredLogData.length;

			filteredLogData.forEach((entry) => {
				try {
					const d = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
					const choices = d.selectedChoices || [];
					const sortedChoices = [...choices].sort();

					for (let i = 0; i < sortedChoices.length; i++) {
						individualChoiceCounts[sortedChoices[i]] =
							(individualChoiceCounts[sortedChoices[i]] || 0) + 1;
						for (let j = i + 1; j < sortedChoices.length; j++) {
							const key = `${sortedChoices[i]}|${sortedChoices[j]}`;
							pairCounts[key] = (pairCounts[key] || 0) + 1;
						}
					}
				} catch (e) {}
			});

			topCorrelations = Object.entries(pairCounts)
				.map(([key, count]) => {
					const [idA, idB] = key.split('|');
					const percent = (count / totalEntries) * 100;
					const probA = individualChoiceCounts[idA] / totalEntries;
					const probB = individualChoiceCounts[idB] / totalEntries;

					const lift = percent / (probA * probB) / 100;

					return { idA, idB, count, percent, probA, probB, lift };
				})
				.sort(correlationSortFunction);
		} else {
			topCorrelations = [];
		}
	}

	// 7. Row Statistics
	$: {
		if (projectData && projectData.rows && filteredLogData.length > 0) {
			rowStatistics = projectData.rows.map((row: any) => {
				const rowObjects = row.objects || [];
				const rowObjectIds = new Set(rowObjects.map((o: any) => o.id));

				let rowTotalSelections = 0;
				const objectCounts: Record<string, number> = {};

				filteredLogData.forEach((entry) => {
					try {
						const d = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
						if (d.selectedChoices) {
							d.selectedChoices.forEach((choiceId: string) => {
								if (rowObjectIds.has(choiceId)) {
									objectCounts[choiceId] = (objectCounts[choiceId] || 0) + 1;
									rowTotalSelections++;
								}
							});
						}
					} catch (e) {}
				});

				return {
					...row,
					totalSelections: rowTotalSelections,
					objectStats: rowObjects
						.map((obj: any) => ({
							...obj,
							count: objectCounts[obj.id] || 0,
							percentInRow:
								rowTotalSelections > 0
									? ((objectCounts[obj.id] || 0) / rowTotalSelections) * 100
									: 0,
							percentTotal: ((objectCounts[obj.id] || 0) / filteredLogData.length) * 100
						}))
						.sort((a: any, b: any) => b.count - a.count)
				};
			});
		} else {
			rowStatistics = [];
		}
	}

	// 8. All Known Choices
	$: allKnownChoices = (() => {
		const choices = new Set<string>();
		logData.forEach((entry) => {
			try {
				const d = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
				if (d.selectedChoices) d.selectedChoices.forEach((c: string) => choices.add(c));
			} catch (e) {}
		});
		return Array.from(choices).sort();
	})();

	let statistics: Record<string, number> = {};
	let objectMap: Record<string, any> = {};
	let objectToRowMap: Record<string, { id: string; title: string }> = {};

	function formatTime(seconds: number): string {
		if (seconds < 60) return `${seconds}s`;
		const mins = Math.floor(seconds / 60);
		if (mins < 60) return `${mins}m`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h`;
		const days = Math.floor(hours / 24);
		return `${days}d ${hours % 24}h`;
	}

	// Statistics Calculation (Based on filtered data)
	$: statistics = (() => {
		if (!filteredLogData || filteredLogData.length === 0) return {};

		const stats: Record<string, number> = {};

		filteredLogData.forEach((entry) => {
			try {
				const data = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
				if (data.selectedChoices && Array.isArray(data.selectedChoices)) {
					data.selectedChoices.forEach((choiceId: string) => {
						stats[choiceId] = (stats[choiceId] || 0) + 1;
					});
				}
			} catch (e) {
				// ignore error
			}
		});
		return stats;
	})();

	$: objectMap = (() => {
		if (!projectData || !projectData.rows) return {};
		const map: Record<string, any> = {};
		const rowMap: Record<string, { id: string; title: string }> = {};

		projectData.rows.forEach((row: any) => {
			if (row.objects) {
				row.objects.forEach((obj: any) => {
					map[obj.id] = obj;
					rowMap[obj.id] = { id: row.id, title: row.title || row.id };
				});
			}
		});
		objectToRowMap = rowMap;
		return map;
	})();

	// Exit Row Statistics
	$: {
		if (filteredLogData.length > 0 && Object.keys(objectToRowMap).length > 0) {
			const exitCounts: Record<string, number> = {};
			let validExits = 0;

			filteredLogData.forEach((entry) => {
				try {
					const d = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
					if (d.selectedChoices && d.selectedChoices.length > 0) {
						const lastChoice = d.selectedChoices[d.selectedChoices.length - 1];
						const row = objectToRowMap[lastChoice];
						if (row) {
							exitCounts[row.id] = (exitCounts[row.id] || 0) + 1;
							validExits++;
						}
					}
				} catch (e) {}
			});

			exitRowStats = Object.entries(exitCounts)
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
		} else {
			exitRowStats = [];
		}
	}
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

				<!-- Bars (Daily/Hourly Count) -->
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

				<!-- Data Points (Accumulated) -->
				{#each visitorGraphData as d, i}
					{@const slotWidth = 900 / visitorGraphData.length}
					{@const x = 50 + i * slotWidth + slotWidth / 2}
					{@const y = 250 - (d.accumulated / maxAccumulated) * 200}
					<circle cx={x} cy={y} r="3" fill="#ef4444" stroke="white" stroke-width="1">
						<title>{t.accumulatedTooltip}: {d.accumulated}</title>
					</circle>
				{/each}

				<!-- Labels -->
				{#if visitorGraphData.length > 0}
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

					<!-- Left Axis Label (Count) -->
					<text x="40" y="50" font-size="12" fill="#3b82f6" text-anchor="end">{maxCount}</text>
					<text x="40" y="250" font-size="12" fill="#3b82f6" text-anchor="end">0</text>

					<!-- Right Axis Label (Accumulated) -->
					<text x="960" y="50" font-size="12" fill="#ef4444" text-anchor="start"
						>{maxAccumulated}</text
					>
					<text x="960" y="250" font-size="12" fill="#ef4444" text-anchor="start">0</text>
				{/if}
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
			{#if generalStats.topViewports && generalStats.totalViewportCount > 0}
				{@const colors = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7', '#9ca3af']}
				{@const top5Total = generalStats.topViewports.reduce((sum, [, count]) => sum + count, 0)}
				{@const otherCount = generalStats.totalViewportCount - top5Total}
				{@const pieData = [
					...generalStats.topViewports.map(([label, count], i) => ({
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
			({t.avg}: {formatTime(generalStats.avgTimeOnPage || 0)}, {t.median}: {formatTime(
				generalStats.medianTimeOnPage || 0
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
	<h2 id="correlations">{t.choiceCorrelations}</h2>
	<select
		id="correlationSort"
		bind:value={correlationSortFunction}
		on:change={() => {
			// Trigger re-calculation
			topCorrelations = [...topCorrelations].sort(correlationSortFunction);
		}}
	>
		<option
			value={(a: correlationObject, b: correlationObject) =>
				calcLogWeightedLift(b) - calcLogWeightedLift(a)}
			selected
		>
			Log-Weighted Lift (Balanced Heuristic)
		</option>

		<option value={(a: correlationObject, b: correlationObject) => calcJaccard(b) - calcJaccard(a)}>
			Jaccard Index (Intersection over Union)
		</option>

		<option value={(a: correlationObject, b: correlationObject) => calcCosine(b) - calcCosine(a)}>
			Cosine Similarity (Ochiai Coefficient)
		</option>

		<option
			value={(a: correlationObject, b: correlationObject) => b.count * b.lift - a.count * a.lift}
		>
			Lift-Weighted Frequency (Popularity Biased)
		</option>

		<option value={(a: correlationObject, b: correlationObject) => b.lift - a.lift}>
			Lift (Interest Measure)
		</option>

		<option value={(a: correlationObject, b: correlationObject) => b.percent - a.percent}>
			Support (%)
		</option>

		<option value={(a: correlationObject, b: correlationObject) => b.count - a.count}>
			Support (Frequency)
		</option>
	</select>

	<div class="correlation-grid">
		{#each topCorrelations.slice(0, 10) as corr}
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
		{#if topCorrelations.length === 0}
			<p class="text-gray italic">{t.noCorrelations}</p>
		{/if}
	</div>

	<!-- User-Entered Words -->
	<h2 id="user-words">{t.userEnteredWords || 'User-Entered Words'}</h2>
	<div class="words-container">
		{#if filteredLogData.some((entry) => {
			try {
				const d = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
				return d.words && d.words.length > 0;
			} catch (e) {
				return false;
			}
		})}
			{@const allWords = []}
			{#each filteredLogData as entry}
				{#if entry}
					{(() => {
						try {
							const d = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
							if (d.words && d.words.length > 0) {
								d.words.forEach((word) => {
									const existing = allWords.find(
										(w) => w.id === word.id && w.replaceText === word.replaceText
									);
									if (existing) {
										existing.count++;
									} else {
										allWords.push({ ...word, count: 1 });
									}
								});
							}
						} catch (e) {}
						return null;
					})()}
				{/if}
			{/each}
			<div class="grid">
				{#each allWords.sort((a, b) => b.count - a.count) as word}
					{@const obj = objectMap[word.id]}
					<div class="card">
						{#if obj}
							<h3>{obj.title || word.id}</h3>
							{#if obj.text}
								<p class="text-sm text-gray">{obj.text}</p>
							{/if}
						{:else}
							<h3>{word.id}</h3>
						{/if}
						<div class="card-content mt-2">
							<p class="text-sm font-bold">{t.userInput || 'User Input'}:</p>
							<p class="text-xs text-gray break-words">{word.replaceText}</p>
						</div>
						<div class="card-footer mt-2">
							<span class="text-gray text-sm">{t.count}</span>
							<span class="text-lg font-bold text-blue">{word.count}</span>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-gray italic">{t.noWordsData || 'No user-entered words'}</p>
		{/if}
	</div>

	<!-- Multiple Use Variables (Repeated Choices) -->
	<h2 id="repeated-choices">{t.repeatedChoices || 'Repeated Choices'}</h2>
	<div class="multiple-use-container">
		{#if filteredLogData.some((entry) => {
			try {
				const d = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
				return d.multipleUseVariable && d.multipleUseVariable.length > 0;
			} catch (e) {
				return false;
			}
		})}
			{@const multipleUseMap = {}}
			{#each filteredLogData as entry}
				{#if entry}
					{(() => {
						try {
							const d = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
							if (d.multipleUseVariable && d.multipleUseVariable.length > 0) {
								d.multipleUseVariable.forEach((item) => {
									if (!multipleUseMap[item.id]) {
										multipleUseMap[item.id] = {
											id: item.id,
											totalCount: 0,
											occurrences: 0,
											distribution: {}
										};
									}
									multipleUseMap[item.id].totalCount += item.count;
									multipleUseMap[item.id].occurrences++;
									const k = item.count;
									multipleUseMap[item.id].distribution[k] =
										(multipleUseMap[item.id].distribution[k] || 0) + 1;
								});
							}
						} catch (e) {}
						return null;
					})()}
				{/if}
			{/each}
			<div class="repeated-choices-list">
				{#each Object.values(multipleUseMap).sort((a, b) => b.totalCount - a.totalCount) as item}
					{@const obj = objectMap[item.id]}
					{@const maxDist = Math.max(...Object.values(item.distribution))}
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
											style="width: {(userCount / maxDist) * 100}%"
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
			{#each Object.entries(statistics).sort(([, a], [, b]) => b - a) as [id, count]}
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
		<pre class="mt-4">{JSON.stringify(statistics, null, 2)}</pre>
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
