import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { CaseView } from "@/components/case/CaseView";
import { PERSONA_COOKIE } from "@/lib/auth/cookies";
import { personaOrDefault } from "@/lib/auth/personas";
import { appDb } from "@/lib/db/app-db";
import { getProvider, parseModelName } from "@/lib/models";
import { assembleCase } from "@/lib/pipeline/assemble";
import { getCaseView } from "@/lib/pipeline/case-view";
import { runCase } from "@/lib/pipeline/run";
import { loadDecision } from "@/lib/pipeline/store";

export const dynamic = "force-dynamic";

export default async function CasePage({
  params, searchParams,
}: { params: Promise<{ ticketId: string }>; searchParams: Promise<{ model?: string }> }) {
  const { ticketId } = await params;
  const { model } = await searchParams;
  const db = appDb();
  if (!assembleCase(db, ticketId)) notFound();
  if (!loadDecision(db, ticketId)) {
    await runCase(db, ticketId, { provider: getProvider(parseModelName(model)) });
  }
  const raw = (await cookies()).get(PERSONA_COOKIE)?.value;
  const view = getCaseView(db, ticketId, personaOrDefault(raw));
  if (!view) notFound();
  return <CaseView view={view} />;
}
