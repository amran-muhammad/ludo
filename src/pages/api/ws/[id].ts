import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, request, locals }) => {
  const { id } = params;
  if (!id) return new Response('Missing game id', { status: 400 });

  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  const env = locals.runtime.env;
  const doId = env.GAME_ROOM.idFromName(id);
  const stub = env.GAME_ROOM.get(doId);

  // Proxy the WebSocket upgrade request to the Durable Object
  return stub.fetch(request);
};
