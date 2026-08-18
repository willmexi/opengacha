"use client";

/**
 * Which pool a screen shows: the `?pool=<slug>` in the url when it names
 * one we sell, else the first in pools.json. Kept in state after that so
 * switching packs does not rewrite history. Callers wrap the component in
 * a Suspense boundary, which useSearchParams needs at build time.
 */

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { POOLS, poolBySlug } from "@/lib/config";

export function usePoolSlug(): [string, (slug: string) => void] {
  const params = useSearchParams();
  const wanted = params.get("pool");
  const [slug, setSlug] = useState(wanted && poolBySlug(wanted) ? wanted : POOLS[0].slug);
  return [slug, setSlug];
}
