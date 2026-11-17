/**
 * WCAG contrast of the colour tokens in `src/index.css`, read straight from
 * the stylesheet: OKLCH -> OKLab -> linear sRGB (clipped to the sRGB gamut, as
 * a browser paints it) -> WCAG 2 relative luminance.
 *
 * Role tokens are often aliases (`--fg-2: var(--muted-foreground)`), so
 * `createTokenResolver` resolves a token the way the browser does on the
 * `<html>` element of each theme: through that theme's cascade of top-level
 * blocks, following `var(--…)` references. A cycle, a reference to nothing
 * or a translucent colour is reported as an error (inner-UI plan F1a, §4.1:
 * no text is dimmed with opacity).
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const CSS = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/index.css"), "utf8");
/** Declarations of one top-level rule (`:root`, `.dark`, `.dark.high-contrast`), first match. */
export function block(selector, css = CSS) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const start = css.search(new RegExp(`^${escaped}\\s*\\{`, "m"));
    if (start < 0)
        throw new Error(`no ${selector} block in index.css`);
    return css.slice(start, css.indexOf("\n}", start));
}
/** An opaque `--name: oklch(L C H)` declaration of `rule`. */
export function oklch(rule, name) {
    const match = rule.match(new RegExp(`--${name}:\\s*oklch\\(\\s*([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)\\s*\\)`));
    if (!match)
        throw new Error(`--${name} is not an opaque oklch(L C H) value in this block`);
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}
/** OKLCH -> linear sRGB, unclipped. */
function linearSrgb([l, c, h]) {
    const a = c * Math.cos((h * Math.PI) / 180);
    const b = c * Math.sin((h * Math.PI) / 180);
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
    ];
}
/** Linear sRGB after clipping in gamma-encoded sRGB (what a browser paints). */
function paintedLinear(color) {
    return linearSrgb(color).map((v) => {
        const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055;
        const clipped = Math.min(1, Math.max(0, encoded));
        return clipped <= 0.04045 ? clipped / 12.92 : ((clipped + 0.055) / 1.055) ** 2.4;
    });
}
/** WCAG relative luminance of an oklch colour (gamut-clipped sRGB). */
export function luminance(color) {
    const [r, g, bl] = paintedLinear(color);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}
/** WCAG 2 contrast ratio of two colours (order-independent). */
export function contrast(x, y) {
    const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
}
/** The 8-bit sRGB pixel a browser paints for an opaque oklch colour. */
export function srgb8(color) {
    return linearSrgb(color).map((v) => {
        const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055;
        return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
    });
}
/**
 * `top` at `alpha` over the opaque `back`, blended in gamma-encoded sRGB the
 * way a browser composites a translucent background (Tailwind's `bg-x/85` is
 * x at 85% alpha).
 */
export function over(top, alpha, back) {
    return top.map((v, i) => Math.round(alpha * v + (1 - alpha) * (back[i] ?? 0)));
}
/** The largest per-channel difference of two pixels (0-255). */
export const channelDelta = (x, y) => Math.max(...x.map((v, i) => Math.abs(v - (y[i] ?? 0))));
/** WCAG 2 contrast ratio of two 8-bit sRGB pixels. */
export function contrastSrgb8(x, y) {
    const lum = (c) => {
        const [r, g, b] = c.map((v) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
}
export const CVD_MODES = ["protanopia", "deuteranopia", "tritanopia"];
/** Machado/Oliveira/Fernandes 2009 supplementary matrices, severity 1.0.
 * https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
 * Applied to linear sRGB (NOT gamma encoded); clip after simulation. */
const MACHADO = {
    protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
export function simulateCvd(linear, mode) {
    return MACHADO[mode].map((row) => Math.max(0, Math.min(1, row.reduce((sum, v, i) => sum + v * linear[i], 0))));
}
/** CIELAB D65 of the painted colour, optionally after full-severity CVD. */
function cielab(color, mode) {
    const linear = paintedLinear(color);
    const [r, g, b] = mode ? simulateCvd(linear, mode) : linear;
    const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
    const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
    const [fx, fy, fz] = [f(x), f(y), f(z)];
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** CIEDE2000 colour difference of two painted colours. */
export function deltaE00(x, y, mode) {
    return deltaE00Lab(cielab(x, mode), cielab(y, mode));
}
/** CIEDE2000 over Lab inputs; independently pinned to Sharma's reference pairs. */
export function deltaE00Lab([L1, a1, b1], [L2, a2, b2]) {
    const rad = Math.PI / 180;
    const Cm = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
    const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1);
    const C2p = Math.hypot(a2p, b2);
    const hue = (a, b) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
    const h1p = hue(a1p, b1);
    const h2p = hue(a2p, b2);
    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) {
        dhp = h2p - h1p;
        if (dhp > 180)
            dhp -= 360;
        else if (dhp < -180)
            dhp += 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
    const Lpm = (L1 + L2) / 2;
    const Cpm = (C1p + C2p) / 2;
    let hpm = h1p + h2p;
    if (C1p * C2p !== 0) {
        if (Math.abs(h1p - h2p) > 180)
            hpm += h1p + h2p < 360 ? 360 : -360;
        hpm /= 2;
    }
    const T = 1 -
        0.17 * Math.cos((hpm - 30) * rad) +
        0.24 * Math.cos(2 * hpm * rad) +
        0.32 * Math.cos((3 * hpm + 6) * rad) -
        0.2 * Math.cos((4 * hpm - 63) * rad);
    const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
    const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
    const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
    const Sc = 1 + 0.045 * Cpm;
    const Sh = 1 + 0.015 * Cpm * T;
    const Rt = -Math.sin(2 * dTheta * rad) * Rc;
    return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
// ---------------------------------------------------------------------------
// Theme cascade and alias resolution
// ---------------------------------------------------------------------------
/** Pseudo-selector for every Tailwind `@theme` block (variables emitted on `:root`, `theme` layer). */
export const THEME_LAYER = "@theme";
/**
 * The blocks that set a token on `<html>` in each theme, winning first.
 * `.dark` and `.high-contrast` have the same specificity, so in the dark
 * high-contrast theme the later `.high-contrast` block beats `.dark`. The
 * `@theme` blocks come last: their layered variables lose to every
 * unlayered block.
 */
export const THEME_CHAINS = {
    light: [":root", THEME_LAYER],
    dark: [".dark", ":root", THEME_LAYER],
    "high contrast": [".high-contrast", ":root", THEME_LAYER],
    "dark high contrast": [".dark.high-contrast", ".high-contrast", ".dark", ":root", THEME_LAYER],
};
export const THEME_NAMES = Object.keys(THEME_CHAINS);
export class TokenError extends Error {
}
const VAR_RE = /var\(\s*--([\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g;
/** A resolver over `css` (default: src/index.css). Names are given without the leading `--`. */
export function createTokenResolver(css = CSS) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const blocks = new Map();
    const declarations = (selector) => {
        let decls = blocks.get(selector);
        if (!decls) {
            decls = new Map();
            let bodies = [];
            if (selector === THEME_LAYER) {
                // Every `@theme`, `@theme inline`, `@theme static` block.
                bodies = [...clean.matchAll(/^@theme\b[^{]*\{([\s\S]*?)\n\}/gm)].map((m) => m[1] ?? "");
            }
            else {
                try {
                    const body = block(selector, clean);
                    bodies = [body.slice(body.indexOf("{") + 1)];
                }
                catch {
                    bodies = [];
                }
            }
            for (const body of bodies) {
                for (const m of body.matchAll(/(--[\w\\.*-]+)\s*:\s*([^;]+);/g)) {
                    const name = m[1] ?? "";
                    if (!decls.has(name))
                        decls.set(name, (m[2] ?? "").trim());
                }
            }
            blocks.set(selector, decls);
        }
        return decls;
    };
    const winner = (theme, name) => {
        const found = THEME_CHAINS[theme].find((selector) => declarations(selector).has(`--${name}`)) ?? null;
        // A light high-contrast value leaking into the dark high-contrast theme:
        // `.dark` sets it, `.dark.high-contrast` does not, so `.high-contrast` wins.
        if (theme === "dark high contrast" && found === ".high-contrast" && declarations(".dark").has(`--${name}`)) {
            throw new TokenError(`--${name}: the light .high-contrast value overrides .dark in the dark high-contrast theme (declare it in .dark.high-contrast)`);
        }
        return found;
    };
    const resolve = (theme, name, stack) => {
        if (stack.includes(name)) {
            throw new TokenError(`cycle ${[...stack, name].map((n) => `--${n}`).join(" -> ")} (${theme})`);
        }
        const selector = winner(theme, name);
        if (!selector)
            throw new TokenError(`--${name} is not defined in the ${theme} theme${stack.length ? ` (via --${stack.join(" -> --")})` : ""}`);
        const raw = declarations(selector).get(`--${name}`) ?? "";
        return raw.replace(VAR_RE, (_whole, ref, fallback) => {
            try {
                return resolve(theme, ref, [...stack, name]);
            }
            catch (error) {
                if (fallback !== undefined && error instanceof TokenError && error.message.startsWith(`--${ref} is not defined`)) {
                    return fallback.trim();
                }
                throw error;
            }
        });
    };
    return {
        winner,
        value: (theme, name) => resolve(theme, name, []),
        color(theme, name) {
            const value = resolve(theme, name, []);
            const match = /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)$/.exec(value);
            if (!match)
                throw new TokenError(`--${name} (${theme}) is not an opaque oklch(L C H) colour: ${value}`);
            return [Number(match[1]), Number(match[2]), Number(match[3])];
        },
    };
}
