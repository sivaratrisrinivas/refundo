import Link from "next/link";
import { cookies } from "next/headers";
import { PersonaSwitcher } from "./PersonaSwitcher";
import { PERSONA_COOKIE } from "@/lib/auth/cookies";
import { isPersona } from "@/lib/auth/personas";

export async function Nav() {
  const jar = await cookies();
  const raw = jar.get(PERSONA_COOKIE)?.value;
  const persona = isPersona(raw) ? raw : "specialist";
  return (
    <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-3">
      <nav className="flex items-center gap-5 text-sm">
        <Link href="/" className="text-base font-semibold">
          Refundo
        </Link>
        <Link href="/">Queue</Link>
        <Link href="/systems">Systems</Link>
        <Link href="/eval">Eval</Link>
        <Link href="/audit">Audit</Link>
      </nav>
      <PersonaSwitcher current={persona} />
    </header>
  );
}
