export function createEditableAttrs(sourceMap?: import('./utils/source-map.js').SourceMap) {
  return (path: string) => {
    if (!sourceMap || !Object.prototype.hasOwnProperty.call(sourceMap, path)) {
      return {}
    }

    return {
      'data-payload-path': path,
      ...(typeof sourceMap[path] === 'object' ? { 'data-payload-type': sourceMap[path].type } : {}),
    }
  }
}
