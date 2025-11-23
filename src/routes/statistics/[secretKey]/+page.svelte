<script lang="ts">
	import { onMount } from 'svelte';

	interface LogEntry {
		project_id: string;
		uid: string;
		data: any;
		created_at: string;
	}
	let logData: LogEntry[] = [];
	let secretKey = '';

	// Project Data Handling
	let projectData: any = null;
	let progressMessage = '';
	const finderUrl = 'https://icc-project-finder.aseli4488.workers.dev/?path=';
	const proxyUrl = 'https://corsproxy.io/?';

	let statistics: Record<string, number> = {};
	let objectMap: Record<string, any> = {};

	function setProgress(msg: string) {
		progressMessage = msg;
	}

	async function fetchWithProgress(
		url: string,
		onProgress: (loaded: number, total: number) => void
	) {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

		const contentLength = response.headers.get('content-length');
		const total = contentLength ? parseInt(contentLength, 10) : 0;
		let loaded = 0;

		const reader = response.body?.getReader();
		const chunks = [];

		if (reader) {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
				loaded += value.length;
				if (onProgress) onProgress(loaded, total);
			}
			const blob = new Blob(chunks);
			return JSON.parse(await blob.text());
		} else {
			return response.json();
		}
	}

	async function main(projectPath: string) {
		setProgress('Finding project.json...');

		let finding_data = await fetch(finderUrl + encodeURIComponent(projectPath))
			.then((response) => response.json())
			.catch((error) => {
				console.error('Error finding project.json:', error);
				setProgress('프로젝트를 찾는 중 오류가 발생했어! 경로가 올바른지 확인해줘!');
				throw error;
			});

		// Check if the finding_data is valid
		if (!finding_data || finding_data.type == 'Unknown') {
			setProgress('프로젝트를 찾을 수 없어! 경로가 올바른지 확인해줘!');
			console.warn('Project not found or unknown type:', finding_data);
			return;
		}

		let project = null;

		// if the type is icc_link
		if (finding_data.type === 'icc_link') {
			// fetch it
			const projectUrl = proxyUrl + finding_data.project;
			setProgress(`Loading project from ${projectUrl}... (${finding_data.message})`);

			project = await fetchWithProgress(projectUrl, (loaded, total) => {
				setProgress(`Loading project.json... ${Math.round(loaded / 1024)}KB`);
			}).catch((error) => {
				console.error('Error fetching project.json:', error);
				setProgress('프로젝트를 불러오는 중 오류가 발생했어! 예측하지 못한 오류야! (오류코드 : 1)');
				throw error;
			});
		} else if (finding_data.type === 'icc') {
			console.log('Project type is ICC');
			console.log('Project data:', finding_data.project);
			project = finding_data.project;
		}

		projectData = project;
		localStorage.setItem(`project_data_${secretKey}`, JSON.stringify(projectData));
		setProgress('Project data loaded successfully!');
		setTimeout(() => setProgress(''), 3000);
	}

	async function updateProjectJson() {
		if (logData.length === 0) {
			alert('No statistics data available to find project URL. Please UPDATE STATISTICS first.');
			return;
		}

		// Get most recent entry
		const sortedData = [...logData].sort(
			(a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
		);
		const latestEntry = sortedData[0];

		let currentURL = '';
		try {
			const parsedData =
				typeof latestEntry.data === 'string' ? JSON.parse(latestEntry.data) : latestEntry.data;
			currentURL = parsedData.currentURL;
		} catch (e) {
			console.error('Error parsing log data', e);
			alert('Error parsing log data');
			return;
		}

		if (!currentURL) {
			alert('Could not find currentURL in the latest log entry.');
			return;
		}

		console.log('Found currentURL:', currentURL);
		await main(currentURL);
	}

	async function loadData() {
		if (!secretKey) return;
		// Handle the form submission logic here
		// console.log('Secret Key submitted:', secretKey);
		let result = await fetch('/api/log', {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${secretKey}`
			}
		}).then((res) => res.json());

		console.log(result);
		logData = result.results || [];
		localStorage.setItem(`statistics_data_${secretKey}`, JSON.stringify(logData));
	}

	onMount(() => {
		// Extract secretKey from URL
		const urlParts = window.location.pathname.split('/');
		secretKey = urlParts[urlParts.length - 1];

		// Validate secretKey format (basic check)
		if (!secretKey || secretKey.length !== 36) {
			console.error('Invalid secret key format');
			return;
		}

		const storedData = localStorage.getItem(`statistics_data_${secretKey}`);
		if (storedData) {
			try {
				logData = JSON.parse(storedData);
			} catch (e) {
				console.error('Failed to parse stored data', e);
			}
		}

		const storedProjectData = localStorage.getItem(`project_data_${secretKey}`);
		if (storedProjectData) {
			try {
				projectData = JSON.parse(storedProjectData);
			} catch (e) {
				console.error('Failed to parse stored project data', e);
			}
		}
	});

	// Statistics Calculation
	$: statistics = (() => {
		if (!logData || logData.length === 0) return {};

		const stats: Record<string, number> = {};

		logData.forEach((entry) => {
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
		projectData.rows.forEach((row: any) => {
			if (row.objects) {
				row.objects.forEach((obj: any) => {
					map[obj.id] = obj;
				});
			}
		});
		return map;
	})();
</script>

<div class="container">
	<h1>Please add this code into {'\<body\>'} of the index.html</h1>
	<div class="code-block">
		<pre>
	{`
	<script src="https://statistics-for-interactive-cyoa.pages.dev/logger.js"></script>
	<script>
		initializeLogging("${logData.length > 0 ? logData[0].project_id : 'YOUR_PROJECT_ID'}")
	</script>
	`}
	</pre>
	</div>

	<h1>Statistics</h1>
	<div class="button-group">
		<button class="btn-primary" on:click={loadData}>UPDATE STATISTICS</button>
		<button class="btn-success" on:click={updateProjectJson}>UPDATE PROJECT JSON</button>
	</div>

	{#if progressMessage}
		<div class="alert" role="alert">
			<p>{progressMessage}</p>
		</div>
	{/if}

	{#if projectData}
		<div class="grid">
			{#each Object.entries(statistics).sort(([, a], [, b]) => b - a) as [id, count]}
				{@const obj = objectMap[id]}
				<div class="card">
					{#if obj}
						{#if obj.image}
							<img
								src={obj.image.startsWith('http') || obj.image.startsWith('data:')
									? obj.image
									: `https://corsproxy.io/?${encodeURIComponent(obj.image)}`}
								alt={obj.title}
							/>
						{/if}
						<h3>{obj.title || id}</h3>
						{#if obj.text}
							<p class="text-sm text-gray">{obj.text}</p>
						{/if}
					{:else}
						<h3>{id}</h3>
						<p class="text-sm text-gray italic">Object data not found</p>
					{/if}
					<div class="card-footer">
						<span class="text-gray text-sm">Count:</span>
						<span class="text-xl font-bold text-blue">{count}</span>
					</div>
					<div class="progress-bar-bg">
						<div class="progress-bar-fill" style="width: {(count / logData.length) * 100}%"></div>
					</div>
					<p class="text-xs text-right text-gray mt-1">
						{((count / logData.length) * 100).toFixed(1)}%
					</p>
				</div>
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<p class="text-gray mb-2">Project data not loaded.</p>
			<p class="text-sm text-gray">
				Click "UPDATE PROJECT JSON" to load object details and images.
			</p>
		</div>
		<pre class="mt-4">{JSON.stringify(statistics, null, 2)}</pre>
	{/if}

	<h2 class="mt-8 mb-4">Raw Data</h2>
	<pre class="code-block text-xs">{JSON.stringify(logData, null, 2)}</pre>
</div>

<style>
	.container {
		font-family: sans-serif;
		max-width: 1200px;
		margin: 0 auto;
		padding: 20px;
	}
	h1,
	h2,
	h3 {
		margin-bottom: 10px;
	}
	.code-block {
		background-color: #1f2937;
		color: #f3f4f6;
		padding: 1rem;
		border-radius: 0.375rem;
		overflow-x: auto;
		margin-bottom: 2rem;
		font-family: monospace;
		font-size: 0.875rem;
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
	.alert {
		background-color: #fef9c3;
		border-left: 4px solid #eab308;
		color: #a16207;
		padding: 1rem;
		margin-bottom: 1rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
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
		height: 128px;
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
</style>
