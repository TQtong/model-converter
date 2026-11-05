declare module 'occt-import-js' {
  const initialize: (options: { locateFile: (file: string) => string }) => Promise<any>
  export default initialize
}
declare module 'assimpjs-fbx' {
  const initialize: (options: { locateFile: (file: string) => string }) => Promise<any>
  export default initialize
}
