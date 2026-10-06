import { handleApprove } from "@/lib/service/cases";

export async function POST(request: Request, ctx: { params: Promise<{ ticketId: string }> }) {
  return handleApprove(request, (await ctx.params).ticketId);
}
