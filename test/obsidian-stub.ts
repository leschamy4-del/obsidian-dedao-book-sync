/**
 * 测试桩：node --test 的 bundle 环境里替代 obsidian 包。
 * npm 的 obsidian 包只含类型声明（package main 为空），esbuild 打测试包时无法解析，
 * 故测试构建用 esbuild alias 指到本文件。单测不会触发网络请求，仅保符号存在。
 */
export async function requestUrl(_params: unknown): Promise<never> {
  throw new Error('test stub: requestUrl 不应在单测中被调用（网络层须以 transport 注入）');
}
