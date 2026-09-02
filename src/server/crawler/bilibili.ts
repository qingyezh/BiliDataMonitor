// B站爬虫：get_user_videos + get_video_info
import type { AxiosInstance } from 'axios'
import { createClient, getJson } from './client.js'
import { getWbiKeys, encWbi } from './wbi.js'

export interface BiliVideoItem {
  bvid: string
  aid: number
  title: string
  play: number
  video_review: number   // 弹幕数
  comment: number        // 评论数
  created: number        // 发布时间戳(秒)
  length: string         // '11:23'
  author: string
  mid: number
  pic: string
}

export interface BiliVideoPage {
  list: {
    vlist: BiliVideoItem[]
  }
  page: {
    count: number
  }
}

export interface BiliVideoInfo {
  bvid: string
  aid: number
  title: string
  duration: number        // 秒
  desc: string
  pic: string
  owner: { mid: number; name: string }
  stat: {
    view: number
    danmaku: number
    reply: number
    favorite: number
    coin: number
    share: number
    like: number
  }
  pubdate: number
}

export class BilibiliAPI {
  private client: AxiosInstance

  constructor(cookie = '') {
    this.client = createClient(cookie)
  }

  /** 用户空间视频列表（WBI 签名） */
  async getUserVideos(mid: number, pn = 1, ps = 40): Promise<BiliVideoPage | null> {
    const keys = await getWbiKeys(this.client)
    if (!keys) return null
    const params = encWbi(
      {
        mid,
        pn,
        ps,
        tid: 0,
        special_type: '',
        order: 'pubdate',
        index: 0,
        keyword: '',
        order_avoided: 'true',
        platform: 'web',
      },
      keys.img_key,
      keys.sub_key,
    )
    return getJson<BiliVideoPage>(this.client, '/x/space/wbi/arc/search', params)
  }

  /** 视频详情（view 接口，stat 含 view/danmaku/reply） */
  async getVideoInfo(bvid: string): Promise<BiliVideoInfo | null> {
    return getJson<BiliVideoInfo>(this.client, '/x/web-interface/view', { bvid })
  }

  /** 分页拉取用户全部视频（支持 max 截断） */
  async getAllUserVideos(mid: number, max: number): Promise<BiliVideoItem[]> {
    const all: BiliVideoItem[] = []
    let pn = 1
    const ps = 40
    for (;;) {
      const page = await this.getUserVideos(mid, pn, ps)
      const vlist = page?.list?.vlist || []
      if (!page || vlist.length === 0) break
      for (const v of vlist) {
        all.push(v)
        if (max > 0 && all.length >= max) return all
      }
      const count = page.page?.count || 0
      if (pn * ps >= count) break
      pn++
      // 限流
      await new Promise(r => setTimeout(r, 500))
    }
    return all
  }
}

/** 时长字符串转秒 */
export function parseLengthToSeconds(length: string): number {
  const parts = length.split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}
