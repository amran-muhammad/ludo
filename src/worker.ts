// Re-export the Durable Object class so Cloudflare can bind it.
// @astrojs/cloudflare with workerEntrypoint will wrap this with the Astro handler
// and make it the worker's default export.
export { GameRoom } from './do/GameRoom';
