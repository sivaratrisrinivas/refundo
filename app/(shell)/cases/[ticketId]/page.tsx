import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { CaseView } from "@/components/case/CaseView";
import { PERSONA_COOKIE } from "@/lib/auth/cookies";
import { isPersona } from "@/lib/auth/personas";
import { appDb } from "@/lib/db/app-db";
import { getProvider, MODEL_NAMES, type ModelName } from "@/lib/models";
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
    const m: ModelName = MODEL_NAMES.includes(model as ModelName) ? (model as ModelName) : "sim-a";
    await runCase(db, ticketId, { provider: getProvider(m) });
  }
  const raw = (await cookies()).get(PERSONA_COOKIE)?.value;
  const view = getCaseView(db, ticketId, isPersona(raw) ? raw : "specialist");
  if (!view) notFound();
  return <CaseView view={view} />;
}
