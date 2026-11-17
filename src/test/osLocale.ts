/**
 * Test helper: pretend the operating system runs in another locale.
 *
 * Every `Intl.*` constructor and `toLocale*` method that gets no explicit
 * locale falls back to `osLocale` while `fn` runs. A formatter that reads the
 * OS default instead of the app language shows up as the wrong language.
 */

type Locales = string | readonly string[] | undefined;

const pick = (locales: Locales, osLocale: string): string | readonly string[] =>
  locales === undefined || (Array.isArray(locales) && locales.length === 0) ? osLocale : locales;

export function withOsLocale<T>(osLocale: string, fn: () => T): T {
  const OriginalDateTimeFormat = Intl.DateTimeFormat;
  const OriginalNumberFormat = Intl.NumberFormat;
  const OriginalListFormat = Intl.ListFormat;
  const OriginalRelativeTimeFormat = Intl.RelativeTimeFormat;
  const dateToLocaleString = Date.prototype.toLocaleString;
  const dateToLocaleDateString = Date.prototype.toLocaleDateString;
  const dateToLocaleTimeString = Date.prototype.toLocaleTimeString;
  const numberToLocaleString = Number.prototype.toLocaleString;

  const wrap = <C extends new (locales?: Locales, options?: never) => unknown>(Original: C): C =>
    new Proxy(Original, {
      construct(target, args: unknown[]) {
        const [locales, ...rest] = args as [Locales, ...unknown[]];
        return Reflect.construct(target, [pick(locales, osLocale), ...rest]);
      },
      apply(target, thisArg, args: unknown[]) {
        const [locales, ...rest] = args as [Locales, ...unknown[]];
        return Reflect.apply(target as unknown as (...a: unknown[]) => unknown, thisArg, [
          pick(locales, osLocale),
          ...rest,
        ]);
      },
    });

  const intl = Intl as unknown as Record<string, unknown>;
  intl.DateTimeFormat = wrap(OriginalDateTimeFormat as never);
  intl.NumberFormat = wrap(OriginalNumberFormat as never);
  intl.ListFormat = wrap(OriginalListFormat as never);
  intl.RelativeTimeFormat = wrap(OriginalRelativeTimeFormat as never);
  Date.prototype.toLocaleString = function (locales?: Locales, options?: Intl.DateTimeFormatOptions) {
    return dateToLocaleString.call(this, pick(locales, osLocale) as string, options);
  };
  Date.prototype.toLocaleDateString = function (locales?: Locales, options?: Intl.DateTimeFormatOptions) {
    return dateToLocaleDateString.call(this, pick(locales, osLocale) as string, options);
  };
  Date.prototype.toLocaleTimeString = function (locales?: Locales, options?: Intl.DateTimeFormatOptions) {
    return dateToLocaleTimeString.call(this, pick(locales, osLocale) as string, options);
  };
  Number.prototype.toLocaleString = function (locales?: Locales, options?: Intl.NumberFormatOptions) {
    return numberToLocaleString.call(this, pick(locales, osLocale) as string, options);
  };

  try {
    return fn();
  } finally {
    intl.DateTimeFormat = OriginalDateTimeFormat;
    intl.NumberFormat = OriginalNumberFormat;
    intl.ListFormat = OriginalListFormat;
    intl.RelativeTimeFormat = OriginalRelativeTimeFormat;
    Date.prototype.toLocaleString = dateToLocaleString;
    Date.prototype.toLocaleDateString = dateToLocaleDateString;
    Date.prototype.toLocaleTimeString = dateToLocaleTimeString;
    Number.prototype.toLocaleString = numberToLocaleString;
  }
}
