/** 源码静态检查的小工具：剥掉注释，避免把文档里的示例代码当成真实代码。 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/gm, '$1');
}
