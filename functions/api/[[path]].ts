import { handleEdgeApiRequest } from '../../src/lib/edgeHandlers';

interface PagesContext {
  request: Request;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  return handleEdgeApiRequest(context.request);
}
