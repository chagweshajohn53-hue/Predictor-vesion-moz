import { handleEdgeV1Request } from '../../src/lib/edgeHandlers';

interface PagesContext {
  request: Request;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  return handleEdgeV1Request(context.request);
}
