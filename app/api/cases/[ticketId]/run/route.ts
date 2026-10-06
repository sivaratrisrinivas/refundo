import { handleRun } from "@/lib/service/cases";

export async function POST(request: Request, ctx: { params: Promise<{ ticketId: string }> }) {
  return handleRun(request, (await ctx.params).ticketId);
}
