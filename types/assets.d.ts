/** Files imported `with { type: "bytes" }` (see `turbopackImportTypeBytes` in next.config.ts). */
declare module "*.woff" {
  const bytes: Uint8Array<ArrayBuffer>;
  export default bytes;
}
