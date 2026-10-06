export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto mt-24 max-w-sm px-6">
      <h1 className="text-xl font-semibold">Refundo</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Invite-only demo. Enter the passcode you were given.
      </p>
      <form method="post" action="/api/login" className="mt-6 flex flex-col gap-3">
        <input
          name="passcode"
          type="password"
          autoFocus
          aria-label="Passcode"
          className="rounded border border-[var(--line)] bg-[var(--card)] px-3 py-2"
        />
        <button className="rounded bg-[var(--accent)] px-3 py-2 text-white" type="submit">
          Enter
        </button>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            Wrong passcode.
          </p>
        ) : null}
      </form>
    </main>
  );
}
