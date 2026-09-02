// axios 封装：UA/重试/超时
import axios, { type AxiosInstance } from 'axios'
import type { AxiosResponse } from 'axios'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export function createClient(cookie: string): AxiosInstance {
  const client = axios.create({
    baseURL: 'https://api.bilibili.com',
    timeout: 20000,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Origin: 'https://www.bilibili.com',
      Referer: 'https://www.bilibili.com/',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  })

  // 重试：429/5xx 指数退避
  client.interceptors.response.use(undefined, async (error) => {
    const cfg = error.config
    if (!cfg || cfg._retryCount >= 3) return Promise.reject(error)
    cfg._retryCount = (cfg._retryCount || 0) + 1
    const status = error.response?.status
    if (status === 429 || (status >= 500 && status <= 504)) {
      const delay = 500 * Math.pow(2, cfg._retryCount)
      await new Promise(r => setTimeout(r, delay))
      return client(cfg)
    }
    return Promise.reject(error)
  })

  return client
}

/** 请求 JSON 并校验 code=0 */
export async function getJson<T = unknown>(
  client: AxiosInstance,
  url: string,
  params?: Record<string, unknown>,
): Promise<T | null> {
  try {
    const res: AxiosResponse<{ code: number; message: string; data: T }> = await client.get(url, { params })
    if (res.data && res.data.code === 0) return res.data.data
    console.warn(`[bilibili] API ${url} code=${res.data?.code} msg=${res.data?.message}`)
    return null
  } catch (e) {
    console.warn(`[bilibili] 请求失败 ${url}: ${(e as Error).message}`)
    return null
  }
}

export { USER_AGENT }
