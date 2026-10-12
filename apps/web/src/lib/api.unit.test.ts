import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, request } from './api';
const respond = (body: string, status: number, type = 'text/html') =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': type } })),
  );
afterEach(() => vi.unstubAllGlobals());
describe('API client', () => {
  it('reports a non-JSON 5xx body (e.g. an nginx 502 page) as an HTTP error', async () => {
    respond('<html><body>502 Bad Gateway</body></html>', 502);
    const failure = request('/health', z.object({}));
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 502, message: 'Error HTTP 502' });
  });
  it('tolerates an empty error body', async () => {
    respond('', 503);
    await expect(request('/health', z.object({}))).rejects.toMatchObject({ status: 503 });
  });
  it('uses the API error message when the body is the JSON error contract', async () => {
    respond(
      JSON.stringify({
        error: { code: 'NOT_FOUND', message: 'Activo no encontrado', request_id: 'r' },
      }),
      404,
      'application/json',
    );
    await expect(request('/assets/x', z.object({}))).rejects.toThrow('Activo no encontrado');
  });
  it('rejects a 200 whose body is not JSON instead of crashing on parse', async () => {
    respond('<html></html>', 200);
    await expect(request('/health', z.object({}))).rejects.toThrow('Respuesta no válida de la API');
  });
  it('validates successful responses with the shared schema', async () => {
    respond(JSON.stringify({ ok: true }), 200, 'application/json');
    await expect(request('/x', z.object({ ok: z.boolean() }))).resolves.toEqual({ ok: true });
  });
});
