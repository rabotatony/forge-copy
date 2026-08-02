// Forge — public webhook endpoint
import { fireWebhookTrigger } from '@/lib/forge/triggers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  try {
    const { slug } = await params;
    const body = await request.text();
    const headers = Object.fromEntries(request.headers.entries());
    const result = await fireWebhookTrigger(slug, {
      method: request.method,
      headers: JSON.stringify(headers),
      body,
    });
    if (result.status === 'rejected') {
      return Response.json({ status: 'rejected', error: result.error }, { status: 401 });
    }
    return Response.json({ runId: result.runId, status: result.status }, { status: 202 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  try {
    const { slug } = await params;
    return Response.json({ slug, message: 'This is a Forge webhook endpoint. Send a POST request to trigger a run.' });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
