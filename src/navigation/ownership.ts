/**
 * Ownership of asynchronous work (plan §4.2).
 *
 * Every write that lands after an await checks that it still owns what it
 * writes:
 *
 * - its data, by request identity: the latest request of its kind, for the
 *   context (project / session) it was loaded for;
 * - anything that changes what the user sees beyond that data - the global
 *   error, the URL, the message target, the place itself - also by place
 *   ownership: no navigation has begun since the work started.
 */
import type { FullAppStore } from "@/store/slices/types";

/**
 * Ownership of the place, taken when asynchronous work starts: true until the
 * next navigation begins. Work left behind by a superseded navigation can no
 * longer take over the screen the user moved to. Reloads take it too, without
 * advancing the epoch, so a reload never supersedes a navigation.
 */
export type PlaceOwner = () => boolean;

/** Take ownership of the current place (see `PlaceOwner`). */
export function ownPlace(
  get: () => Pick<FullAppStore, "navigationEpoch">,
): PlaceOwner {
  const epoch = get().navigationEpoch;
  return () => get().navigationEpoch === epoch;
}
