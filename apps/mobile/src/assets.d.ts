/** Images bundled by Metro resolve to an asset reference that <Image source> accepts. */
declare module '*.png' {
  const asset: number;
  export default asset;
}
