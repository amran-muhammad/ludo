import type { APIRoute } from 'astro';

export const POST: APIRoute = async () => {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return new Response(JSON.stringify({ id }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
