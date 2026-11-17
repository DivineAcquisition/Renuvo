"use client";

/**
 * Like Convex's useQuery, but while new arguments load it keeps answering with the last result instead of
 * undefined. Screens that pass the current minute as an argument would otherwise drop back to their loading
 * state, and lose what the person was typing, every time the minute changes.
 */
import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { useRef } from "react";

export function useStableQuery<Query extends FunctionReference<"query">>(query: Query, ...args: OptionalRestArgsOrSkip<Query>): FunctionReturnType<Query> | undefined {
  const result = useQuery(query, ...args);
  const last = useRef(result);
  if (result !== undefined) last.current = result;
  // The previous answer, kept only until the new one arrives. A skipped query answers nothing.
  return result === undefined && args[0] !== "skip" ? last.current : result;
}
