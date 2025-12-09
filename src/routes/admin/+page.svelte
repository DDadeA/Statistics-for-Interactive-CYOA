<script>
	export let data;
</script>

<!-- 로딩 기다릴 필요 없음. 이미 들어있음. -->
<ul>
	{#each data.logs as log}
		<li>{log}</li>
	{/each}
</ul>
