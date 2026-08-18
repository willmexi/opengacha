import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spins · OpenGacha",
  description: "The reel: a pool's cards at full tilt while the draw lands, braking onto the one you drew.",
};

export default function SpinnerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
