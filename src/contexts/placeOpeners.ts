/**
 * How the shell opens a project and a session (its sidebar handlers), for
 * surfaces outside the sidebar that open them too - the ⌘K palette (T10).
 * Without a provider (a palette rendered on its own) the openers are plain
 * `navigate` moves.
 */
import { createContext, useContext } from "react";
import { DEFAULT_PLACE_OPENERS, type PlaceOpeners } from "@/navigation/paletteOpen";

export const PlaceOpenersContext = createContext<PlaceOpeners | null>(null);

export const usePlaceOpeners = (): PlaceOpeners => useContext(PlaceOpenersContext) ?? DEFAULT_PLACE_OPENERS;
