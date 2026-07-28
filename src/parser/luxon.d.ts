declare module "luxon" {
  export interface DateTimeFormatOptions {
    readonly suppressMilliseconds?: boolean;
  }

  export class DateTime {
    public readonly isValid: boolean;
    public readonly year: number;
    public readonly zoneName: string;

    public static fromJSDate(date: Date, options: { readonly zone: string }): DateTime;
    public static fromISO(value: string, options: { readonly zone: string }): DateTime;
    public static fromObject(
      values: { readonly year: number; readonly month: number; readonly day: number },
      options: { readonly zone: string },
    ): DateTime;

    public toISO(options?: DateTimeFormatOptions): string | null;
    public toISODate(): string | null;
    public toFormat(format: string): string;
    public toUTC(): DateTime;
    public toJSDate(): Date;
    public plus(values: { readonly days: number }): DateTime;
    public startOf(unit: "day"): DateTime;
    public valueOf(): number;
  }
}
