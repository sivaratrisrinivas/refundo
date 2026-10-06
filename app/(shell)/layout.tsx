import { Nav } from "@/components/Nav";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-[1500px] px-6 py-6">{children}</main>
    </>
  );
}
