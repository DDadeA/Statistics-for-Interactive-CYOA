<script lang="ts">
	let secretKey: string = '';

	function handleSubmit() {
		// Locate to the statistics page with the secret key
		if (secretKey.trim().length === 0) {
			alert('Please enter a valid secret key.');
			return;
		}
		window.location.href = `/statistics/${secretKey.trim()}`;
	}
</script>

<h1 class="text-2xl font-bold mb-4">Statistics</h1>
<form on:submit|preventDefault={handleSubmit} class="mb-4">
	<input
		type="text"
		bind:value={secretKey}
		placeholder="Enter your secret key"
		class="border p-2 rounded"
	/>
	<button type="submit" class="bg-blue-500 text-white p-2 rounded">Submit</button>
</form>
