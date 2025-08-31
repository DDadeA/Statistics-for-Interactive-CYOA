<script lang="ts">
	interface LogEntry {
		project_id: string;
		uid: string;
		data: any;
		created_at: string;
	}

	let secretKey = '';
	let logData: LogEntry[] = [];

	async function handleSubmit() {
		// Handle the form submission logic here
		// console.log('Secret Key submitted:', secretKey);
		let result = await fetch('/api/statistics', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${secretKey}`
			}
			// body: JSON.stringify({ secret_key: secretKey })
		}).then((res) => res.json());

		console.log(result);
		logData = result.logs || [];
	}
</script>

<h1 class="text-2xl font-bold mb-4">Statistics</h1>
{#if logData.length > 0}
	<pre>{String(logData)}</pre>
{:else}
	<form on:submit|preventDefault={handleSubmit} class="mb-4">
		<input
			type="text"
			bind:value={secretKey}
			placeholder="Enter your secret key"
			class="border p-2 rounded"
		/>
		<button type="submit" class="bg-blue-500 text-white p-2 rounded">Submit</button>
	</form>
{/if}
