/**
 * The slice of `qrcode` the web app uses. The package ships no types and the
 * workspace doesn't carry `@types/qrcode`; `create` is the pure encoder, with
 * no canvas or DOM behind it.
 */
declare module 'qrcode' {
  export type QrModules = {
    size: number;
    get(row: number, column: number): number;
  };

  export function create(
    text: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' },
  ): { modules: QrModules };
}
