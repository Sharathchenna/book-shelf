// foliate-js ships plain ES modules without type declarations; app/components/reader/foliate.ts
// wraps the parts the reader uses in typed interfaces.
declare module "foliate-js/view.js";
declare module "foliate-js/paginator.js";
declare module "foliate-js/overlayer.js" {
  export const Overlayer: {
    highlight: unknown;
    underline: unknown;
    outline: unknown;
  };
}
