import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Hub",
  description: "Chat met meerdere LLM-providers, webzoeken en artifacts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
