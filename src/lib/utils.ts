export const getHash = async (secret_key: string, pepper: string) => {
	// Ensure secret_key is a string
	if (typeof secret_key !== 'string') {
		throw new Error('Secret key must be a string');
	}

	// Ensure pepper is defined
	if (!pepper) {
		throw new Error('Pepper is not defined in environment variables');
	}

	// Append pepper to the secret key before hashing
	secret_key = secret_key + pepper;

	return await crypto.subtle
		.digest('SHA-256', new TextEncoder().encode(secret_key))
		.then((hashBuffer) => {
			return Array.from(new Uint8Array(hashBuffer))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
		});
};

export const query = async (platform: App.Platform, query: string, params?: any[]) => {
	// @ts-ignore
	const DB = platform.env.DB;
	const statement = DB.prepare(query).bind(...(params || []));
	const result = await statement.all();

	return result;
};
