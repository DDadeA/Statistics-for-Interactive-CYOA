<script lang="ts">
	import { onMount } from 'svelte';
	import { translations } from '$lib/translations';
	import type { LogEntry } from '$lib/types';
	import StatisticsDashboard from '$lib/components/statisticsDashboard.svelte';
	import { finderUrl, proxyUrl, fetchWithProgress } from '$lib/utils';
	import { loadAllLogs } from '$lib/logLoader';

	/** Cursor-paginated log endpoint, e.g. /api/log or /admin/api/log. */
	export let endpoint: string;
	export let headers: HeadersInit | undefined = undefined;
	export let params: Record<string, string> | undefined = undefined;
	/** When set, the project.json is cached in localStorage under this key. */
	export let projectCacheKey: string | undefined = undefined;
	/** Load logs and the project.json as soon as the viewer mounts. */
	export let autoLoad = false;
	export let onLoaded: ((entries: LogEntry[]) => void) | undefined = undefined;

	let logData: LogEntry[] = [];
	let currentLang = 'en';
	let projectData: any = null;
	let progressMessage = '';
	let loadError = '';
	let isLoading = false;
	let parserWorker: Worker | null = null;
	let parserRequestId = 0;
	const parserRequests = new Map<
		number,
		{ resolve: (entries: LogEntry[]) => void; reject: (error: Error) => void }
	>();

	$: t = translations[currentLang as keyof typeof translations];

	interface ParserResponse {
		requestId: number;
		entries?: LogEntry[];
		error?: string;
	}

	function parseEntries(entries: LogEntry[]): Promise<LogEntry[]> {
		if (!parserWorker) {
			return Promise.reject(new Error(t.parserUnavailable));
		}

		const requestId = ++parserRequestId;
		return new Promise((resolve, reject) => {
			parserRequests.set(requestId, { resolve, reject });
			try {
				parserWorker?.postMessage({ requestId, entries });
			} catch (error) {
				parserRequests.delete(requestId);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	function setProgress(msg: string) {
		progressMessage = msg;
	}

	async function main(projectPath: string) {
		setProgress(t.findingProject);

		let finding_data = await fetch(finderUrl + encodeURIComponent(projectPath))
			.then((response) => response.json())
			.catch((error) => {
				console.error('Error finding project.json:', error);
				setProgress(t.projectNotFound);
				throw error;
			});

		// Check if the finding_data is valid
		if (!finding_data || finding_data.type == 'Unknown') {
			setProgress(t.projectNotFound);
			console.warn('Project not found or unknown type:', finding_data);
			return;
		}

		let project = null;

		// if the type is icc_link
		if (finding_data.type === 'icc_link') {
			// fetch it
			const projectUrl = proxyUrl + finding_data.project;
			setProgress(`${t.loadingProject} ${projectUrl}... (${finding_data.message})`);

			project = await fetchWithProgress(projectUrl, (loaded) => {
				setProgress(`Loading project.json... ${Math.round(loaded / 1024)}KB`);
			}).catch((error) => {
				console.error('Error fetching project.json:', error);
				setProgress(t.errorFetching);
				throw error;
			});
		} else if (finding_data.type === 'icc') {
			project = finding_data.project;
		}

		projectData = project;
		if (projectCacheKey) {
			localStorage.setItem(`project_data_${projectCacheKey}`, JSON.stringify(projectData));
		}
		setProgress(t.projectLoaded);
		setTimeout(() => setProgress(''), 3000);
	}

	const MAX_URL_OPTIONS = 20;
	let selectedUrl = '';

	// Page URLs found in the logs, most common first
	function countUrls(entries: LogEntry[]): { url: string; count: number }[] {
		const urlCount = new Map<string, number>();
		for (const entry of entries) {
			let entryURL: string | undefined;
			try {
				const parsedData =
					entry.parsedData ??
					(typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data);
				entryURL = parsedData?.currentURL;
			} catch {
				continue;
			}
			if (typeof entryURL !== 'string' || !entryURL) continue;
			urlCount.set(entryURL, (urlCount.get(entryURL) ?? 0) + 1);
		}
		return [...urlCount.entries()]
			.map(([url, count]) => ({ url, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, MAX_URL_OPTIONS);
	}

	$: urlOptions = countUrls(logData);
	$: if (selectedUrl && !urlOptions.some((option) => option.url === selectedUrl)) selectedUrl = '';

	async function updateProjectJson() {
		if (logData.length === 0) {
			alert(t.noStatsData);
			return;
		}

		const chosenUrl = selectedUrl || urlOptions[0]?.url;
		if (!chosenUrl) {
			alert(t.noCurrentUrl);
			return;
		}

		try {
			const urlObj = new URL(chosenUrl);
			urlObj.search = '';
			urlObj.hash = '';
			await main(urlObj.toString());
		} catch (error) {
			console.error('Failed to load project data from log URLs:', error);
			setProgress(t.errorFetching);
		}
	}

	async function loadData() {
		if (isLoading) return;

		isLoading = true;
		loadError = '';
		setProgress(t.loadingStats);

		try {
			logData = await loadAllLogs({
				endpoint,
				headers,
				params,
				onPage: parseEntries,
				onProgress: (loaded, pageNumber) =>
					setProgress(`${t.loadingStats} ${loaded.toLocaleString()} entries · page ${pageNumber}`),
				errorMessages: {
					unauthorized: t.invalidSecretKey,
					failed: t.loadFailed,
					invalidResponse: t.invalidResponse,
					missingCursor: t.missingCursor
				}
			});

			onLoaded?.(logData);
			setProgress(`${t.statsLoaded} ${logData.length.toLocaleString()} entries.`);
			setTimeout(() => setProgress(''), 5000);
		} catch (error) {
			console.error('Failed to load statistics:', error);
			loadError = error instanceof Error ? error.message : String(error);
			setProgress('');
		} finally {
			isLoading = false;
		}
	}

	function downloadData() {
		const exportEntries = logData.map(({ parsedData, timestamp, ...entry }) => ({
			...entry,
			data: JSON.stringify(parsedData ?? {})
		}));
		const blob = new Blob([JSON.stringify(exportEntries, null, 2)], {
			type: 'application/json'
		});
		const downloadUrl = URL.createObjectURL(blob);
		const downloadAnchor = document.createElement('a');
		downloadAnchor.href = downloadUrl;
		downloadAnchor.download = 'statistics_data.json';
		downloadAnchor.click();
		setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
	}

	onMount(() => {
		try {
			parserWorker = new Worker(new URL('./stats.worker.ts', import.meta.url), {
				type: 'module'
			});
		} catch (error) {
			console.error('Failed to initialize the statistics parser:', error);
			loadError = t.parserUnavailable;
			return;
		}
		parserWorker.onmessage = (event: MessageEvent<ParserResponse>) => {
			const pending = parserRequests.get(event.data.requestId);
			if (!pending) return;
			parserRequests.delete(event.data.requestId);
			if (event.data.error) pending.reject(new Error(event.data.error));
			else pending.resolve(event.data.entries ?? []);
		};
		parserWorker.onerror = (event) => {
			const error = new Error(event.message || t.parserFailed);
			for (const pending of parserRequests.values()) pending.reject(error);
			parserRequests.clear();
			parserWorker?.terminate();
			parserWorker = null;
		};

		if (projectCacheKey) {
			const storedProjectData = localStorage.getItem(`project_data_${projectCacheKey}`);
			if (storedProjectData) {
				try {
					projectData = JSON.parse(storedProjectData);
				} catch (e) {
					console.error('Failed to parse stored project data', e);
				}
			}
		}

		if (autoLoad) {
			loadData().then(() => {
				if (logData.length > 0) return updateProjectJson();
			});
		}

		return () => parserWorker?.terminate();
	});
</script>

<div class="container">
	<div class="language-switcher">
		<span class="icon">🌐</span>
		<button class:active={currentLang === 'en'} on:click={() => (currentLang = 'en')}>EN</button>
		<span class="separator">|</span>
		<button class:active={currentLang === 'ko'} on:click={() => (currentLang = 'ko')}>KO</button>
	</div>
	<div class="button-group">
		<button class="btn-primary" disabled={isLoading} on:click={loadData}
			>{isLoading ? t.loadingStats : t.updateStatistics}</button
		>
		<button
			class="btn-success"
			disabled={isLoading || logData.length === 0}
			on:click={updateProjectJson}>{t.updateProjectJson}</button
		>
		<button class="btn-secondary" disabled={logData.length === 0} on:click={downloadData}
			>{t.downloadData}</button
		>
	</div>
	{#if urlOptions.length > 1}
		<label class="url-picker">
			<span>{t.projectUrl}</span>
			<select bind:value={selectedUrl}>
				<option value="">{t.mostCommonUrl}</option>
				{#each urlOptions as option}
					<option value={option.url}>{option.count.toLocaleString()} · {option.url}</option>
				{/each}
			</select>
		</label>
	{/if}
	{#if progressMessage}
		<p class="load-status" role="status" aria-live="polite">{progressMessage}</p>
	{/if}
	{#if loadError}
		<p class="load-error" role="alert">{loadError}</p>
	{/if}
	{#if logData.length > 0}
		<p class="data-coverage">
			{t.completeHistory}
			{logData.length.toLocaleString()}
			{t.loadedEntries}
		</p>
	{/if}

	<StatisticsDashboard {logData} {projectData} {currentLang} {progressMessage}
	></StatisticsDashboard>
</div>

<style>
	.container {
		font-family: sans-serif;
		max-width: 1200px;
		margin: 0 auto;
		padding: 20px;
		position: relative;
	}
	.load-status,
	.data-coverage {
		margin: 0.75rem 0;
		color: #4b5563;
		font-size: 0.875rem;
	}
	.load-error {
		margin: 0.75rem 0;
		padding: 0.75rem 1rem;
		border-left: 4px solid #dc2626;
		background: #fef2f2;
		color: #991b1b;
	}
	button:disabled {
		cursor: wait;
		opacity: 0.65;
	}
	.language-switcher {
		position: absolute;
		top: 20px;
		right: 20px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background-color: #f3f4f6;
		padding: 0.5rem 1rem;
		border-radius: 9999px;
		font-size: 0.875rem;
		font-weight: bold;
		z-index: 10;
	}
	.language-switcher .icon {
		font-size: 1rem;
		margin-right: 0.25rem;
	}
	.language-switcher button {
		background: transparent;
		color: #9ca3af;
		padding: 0;
		border-radius: 0;
		font-weight: bold;
	}
	.language-switcher button:hover {
		background: transparent;
		color: #6b7280;
	}
	.language-switcher button.active {
		color: #3b82f6;
	}
	.language-switcher .separator {
		color: #d1d5db;
	}
	.url-picker {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
		font-size: 0.875rem;
		color: #4b5563;
	}
	.url-picker select {
		flex: 1;
		min-width: 0;
		max-width: 100%;
		padding: 0.25rem 0.5rem;
	}
	.button-group {
		display: flex;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	button {
		padding: 0.5rem 1rem;
		border-radius: 0.25rem;
		border: none;
		color: white;
		font-weight: bold;
		cursor: pointer;
	}
	.btn-primary {
		background-color: #3b82f6;
	}
	.btn-primary:hover {
		background-color: #1d4ed8;
	}
	.btn-success {
		background-color: #22c55e;
	}
	.btn-success:hover {
		background-color: #15803d;
	}
	.btn-secondary {
		background-color: #6b7280;
	}
	.btn-secondary:hover {
		background-color: #4b5563;
	}
</style>
