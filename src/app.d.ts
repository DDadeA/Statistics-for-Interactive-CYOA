// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import { DurableObjectNamespace, D1Database } from '@cloudflare/workers-types';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		interface Platform {
			env: {
				COUNTER: DurableObjectNamespace;
				DB: D1Database;
				pepper: string;
			};
			context: {
				waitUntil(promise: Promise<any>): void;
			};
			caches: CacheStorage & { default: Cache };
		}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
