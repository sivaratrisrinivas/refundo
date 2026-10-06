import { handleReply } from "@/lib/service/cases";

export async function POST(request: Request, ctx: { params: Promise<{ ticketId: string }> }) {
  return handleReply(request, (await ctx.params).ticketId);
}
