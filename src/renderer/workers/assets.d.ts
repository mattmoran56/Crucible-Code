// Vite's `?url` imports resolve to the asset's served URL.
declare module '*?url' {
  const url: string
  export default url
}
