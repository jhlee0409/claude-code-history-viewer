export type Oklch = [number, number, number];
export type Srgb8 = [number, number, number];
export type CvdMode = "protanopia" | "deuteranopia" | "tritanopia";
export const CVD_MODES: readonly CvdMode[];
export const THEME_LAYER: "@theme";
export const THEME_CHAINS: {
  readonly light: readonly [":root", "@theme"];
  readonly dark: readonly [".dark", ":root", "@theme"];
  readonly "high contrast": readonly [".high-contrast", ":root", "@theme"];
  readonly "dark high contrast": readonly [".dark.high-contrast", ".high-contrast", ".dark", ":root", "@theme"];
};
export type ThemeName = keyof typeof THEME_CHAINS;
export const THEME_NAMES: ThemeName[];
export class TokenError extends Error {}
export interface TokenResolver {
  winner(theme: ThemeName, name: string): string | null;
  value(theme: ThemeName, name: string): string;
  color(theme: ThemeName, name: string): Oklch;
}
export function block(selector: string, css?: string): string;
export function oklch(rule: string, name: string): Oklch;
export function luminance(color: Oklch): number;
export function contrast(x: Oklch, y: Oklch): number;
export function srgb8(color: Oklch): Srgb8;
export function over(top: Srgb8, alpha: number, back: Srgb8): Srgb8;
export function channelDelta(x: Srgb8, y: Srgb8): number;
export function contrastSrgb8(x: Srgb8, y: Srgb8): number;
export function simulateCvd(linear: [number, number, number], mode: CvdMode): [number, number, number];
export function deltaE00(x: Oklch, y: Oklch, mode?: CvdMode): number;
export function deltaE00Lab(x: [number, number, number], y: [number, number, number]): number;
export function createTokenResolver(css?: string): TokenResolver;
