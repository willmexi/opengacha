import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "User profile · OpenGacha",
  description: "Your pulls, the cards you hold in every pool on this site, what they earned, and the way to take them back.",
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
