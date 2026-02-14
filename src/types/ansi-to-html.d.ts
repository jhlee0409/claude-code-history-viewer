declare module "ansi-to-html" {
  interface ConstructorOptions {
    fg?: string;
    bg?: string;
    newline?: boolean;
    escapeXML?: boolean;
    stream?: boolean;
    colors?: string[] | Record<string, string>;
  }

  export default class Convert {
    constructor(options?: ConstructorOptions);
    toHtml(input: string): string;
  }
}
