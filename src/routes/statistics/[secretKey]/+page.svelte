<script lang="ts">
	import { onMount } from 'svelte';

	interface LogEntry {
		project_id: string;
		uid: string;
		data: any;
		created_at: string;
	}
	let logData: LogEntry[] = [];

	async function loadData(secretKey: string) {
		// Handle the form submission logic here
		// console.log('Secret Key submitted:', secretKey);
		let result = await fetch('/api/log', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${secretKey}`
			}
		}).then((res) => res.json());

		console.log(result);
		logData = result.result || [];
	}

	onMount(() => {
		// Extract secretKey from URL
		const urlParts = window.location.pathname.split('/');
		const secretKey = urlParts[urlParts.length - 1];

		// Validate secretKey format (basic check)
		if (!secretKey || secretKey.length !== 36) {
			console.error('Invalid secret key format');
			return;
		}

		loadData(secretKey);
	});
</script>

<h1>Please add this code into {'\<body\>'} of the index.html</h1>
<pre class="code-block">
	{`
	<script src="https://statistics-for-interactive-cyoa.pages.dev/logger.js"></script>
	<script>
		initializeLogging("${logData.project_id}")
	</script>
	`}
</pre>
<h1 class="text-2xl font-bold mb-4">Statistics</h1>
<pre>{String(logData)}</pre>
