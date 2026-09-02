// WBI 签名（含 key 实例级缓存 TTL 12h）
import crypto from 'node:crypto'
import type { AxiosInstance } from 'axios'
import { getJson } from './client.js'

// B站前端硬编码混淆表
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

interface WbiKeys {
  img_key: string
  sub_key: string
  fetched_at: number
}

const KEY_TTL = 12 * 3600 * 1000 // 12h
let cachedKeys: WbiKeys | null = null

function getMixinKey(orig: string): string {
  let out = ''
  for (const i of MIXIN_KEY_ENC_TAB) out += orig[i]
  return out.slice(0, 32)
}

function filterChars(v: unknown): string {
  return String(v).replace(/[!'()*]/g, '')
}

export function encWbi(params: Record<string, unknown>, imgKey: string, subKey: string): Record<string, unknown> {
  const mixinKey = getMixinKey(imgKey + subKey)
  const out: Record<string, unknown> = { ...params }
  out.wts = Math.round(Date.now() / 1000)
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
  const cleaned: Record<string, string> = {}
  for (const [k, v] of Object.entries(sorted)) cleaned[k] = filterChars(v)
  const query = Object.entries(cleaned).map(([k, v]) => `${k}=${v}`).join('&')
  out.w_rid = crypto.createHash('md5').update(query + mixinKey).digest('hex')
  return out
}

async function fetchWbiKeys(client: AxiosInstance): Promise<WbiKeys | null> {
  const data = await getJson<{ wbi_img: { img_url: string; sub_url: string } }>(
    client,
    '/x/web-interface/nav',
  )
  if (!data?.wbi_img) return null
  const imgKey = data.wbi_img.img_url.split('/').pop()?.split('.')[0] || ''
  const subKey = data.wbi_img.sub_url.split('/').pop()?.split('.')[0] || ''
  if (!imgKey || !subKey) return null
  return { img_key: imgKey, sub_key: subKey, fetched_at: Date.now() }
}

export async function getWbiKeys(client: AxiosInstance): Promise<WbiKeys | null> {
  if (cachedKeys && Date.now() - cachedKeys.fetched_at < KEY_TTL) return cachedKeys
  const keys = await fetchWbiKeys(client)
  if (keys) {
    cachedKeys = keys
    return keys
  }
  // 缓存过期但拉取失败：用旧缓存（如果有）
  return cachedKeys
}
