import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Packs · OpenGacha",
  description: "Rip a pack from an on-chain pool: the cert prints, the card is sealed, and you keep it or take the buyback.",
};

export default function PacksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
