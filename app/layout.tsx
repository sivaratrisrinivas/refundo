import type { Metadata } from "next";
import "./globals.css";
import { SyntheticBanner } from "@/components/SyntheticBanner";

export const metadata: Metadata = {
  title: "Refundo",
  description: "Policy-priced Credit decisions for failed Agent work. Fully simulated demo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <SyntheticBanner />
        {children}
      </body>
    </html>
  );
}
