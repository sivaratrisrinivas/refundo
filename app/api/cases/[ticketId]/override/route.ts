import { handleOverride } from "@/lib/service/cases";

export async function POST(request: Request, ctx: { params: Promise<{ ticketId: string }> }) {
  return handleOverride(request, (await ctx.params).ticketId);
}
