// ============================================================
// Forge — workflow marketplace catalog endpoint
// ============================================================
// GET /api/forge/marketplace
//   → { workflows: MarketplaceWorkflow[] }
//
// Optional query params:
//   ?category=build   case-insensitive filter by category
//                     (Build, Test, Deploy, Security, Utility)
//
// The catalog is a static, readonly array (see
// `@/lib/forge/marketplace`), so this endpoint is essentially a
// thin filter over an in-memory list — no DB access.
// ============================================================
import type { NextRequest } from 'next/server';
import {
  MARKETPLACE_WORKFLOWS,
  type MarketplaceCategory,
  type MarketplaceWorkflow,
} from '@/lib/forge/marketplace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CATEGORY_INDEX: Record<string, MarketplaceCategory> = {
  build: 'Build',
  test: 'Test',
  deploy: 'Deploy',
  security: 'Security',
  utility: 'Utility',
};

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const rawCategory = req.nextUrl.searchParams.get('category');
    if (rawCategory === null || rawCategory.trim() === '') {
      const workflows: MarketplaceWorkflow[] = [...MARKETPLACE_WORKFLOWS];
      return Response.json({ workflows });
    }

    const key = rawCategory.trim().toLowerCase();
    const matched = CATEGORY_INDEX[key];
    if (!matched) {
      return Response.json(
        {
          error: `Unknown category "${rawCategory}". Valid categories: ${Object.keys(CATEGORY_INDEX).join(', ')}`,
        },
        { status: 400 },
      );
    }

    const workflows = MARKETPLACE_WORKFLOWS.filter((w) => w.category === matched);
    return Response.json({ workflows });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
