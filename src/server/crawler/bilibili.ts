// B站爬虫：get_user_videos + get_video_info + 动态/专栏
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

export interface BiliDynamicStat {
  like: number
  reply: number
  forward: number
  favorite?: number
}

export interface BiliDynamicInfo {
  id: string
  type: string
  title: string
  author_name: string
  author_id: number
  created_time: number
  stat: BiliDynamicStat
  rid: string
}

export interface BiliColumnInfo {
  cvid: string
  title: string
  author_name: string
  author_id: number
  created_time: number
  like: number
  reply: number
  favorite: number
  cid: string
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

  /** 动态详情（新版API） */
  async getDynamicDetail(dynamicId: string): Promise<BiliDynamicInfo | null> {
    const data = await getJson<{ item: Record<string, unknown> }>(
      this.client,
      '/x/polymer/web-dynamic/v1/detail',
      { timezone_offset: '-480', id: dynamicId }
    )
    if (!data?.item) return null
    return this.parseDynamicItem(data.item, dynamicId)
  }

  /** 动态详情（旧版API，fallback） */
  async getDynamicDetailOld(dynamicId: string): Promise<BiliDynamicInfo | null> {
    const data = await getJson<{ card: { desc: Record<string, unknown> } }>(
      this.client,
      '/dynamic_svr/v1/dynamic_svr/get_dynamic_detail',
      { dynamic_id: dynamicId }
    )
    if (!data?.card?.desc) return null
    const desc = data.card.desc as Record<string, unknown>
    const userProfile = desc.user_profile as Record<string, unknown> | undefined
    const userInfo = userProfile?.info as Record<string, unknown> | undefined
    return {
      id: dynamicId,
      type: String(desc.type || 'dynamic'),
      title: String(desc.dynamic || ''),
      author_name: String(userInfo?.uname || ''),
      author_id: Number(desc.uid || 0),
      created_time: Number(desc.timestamp || 0),
      stat: {
        like: Number(desc.like || 0),
        reply: Number(desc.comment || 0),
        forward: Number(desc.repost || 0),
      },
      rid: String(desc.rid || dynamicId),
    }
  }

  /** 解析动态item（新版API） */
  private parseDynamicItem(item: Record<string, unknown>, dynamicId: string): BiliDynamicInfo {
    const modules = item.modules as Record<string, Record<string, unknown>> | undefined
    const basic = item.basic as Record<string, unknown> | undefined

    let like = 0, reply = 0, forward = 0, favorite = 0
    let authorName = '', authorId = 0, createdTime = 0
    let title = ''

    if (modules) {
      // 统计数据
      const statModule = modules.MODULE_TYPE_STAT as Record<string, unknown> | undefined
      if (statModule) {
        const statData = (statModule.stat || statModule.module_stat || statModule) as Record<string, unknown>
        if (typeof statData === 'object') {
          const likeInfo = statData.like as Record<string, number> | undefined
          if (likeInfo) like = likeInfo.count || 0
          const commentInfo = statData.comment as Record<string, number> | undefined
          if (commentInfo) reply = commentInfo.count || 0
          const forwardInfo = statData.forward as Record<string, number> | undefined
          if (forwardInfo) forward = forwardInfo.count || 0
          const favoriteInfo = statData.favorite as Record<string, number> | undefined
          if (favoriteInfo) favorite = favoriteInfo.count || 0
        }
      }

      // 作者信息
      const authorModule = modules.MODULE_TYPE_AUTHOR as Record<string, unknown> | undefined
      if (authorModule) {
        const author = authorModule.author as Record<string, unknown> | undefined
        if (author) {
          authorName = String(author.name || '')
          authorId = Number(author.mid || 0)
        }
        createdTime = Number(authorModule.pub_ts || 0)
      }

      // 标题
      const titleModule = modules.MODULE_TYPE_TITLE as Record<string, unknown> | undefined
      if (titleModule) {
        title = String(titleModule.text || '')
      }

      // 内容摘要
      if (!title) {
        const contentModule = modules.MODULE_TYPE_CONTENT as Record<string, unknown> | undefined
        if (contentModule) {
          const paragraphs = contentModule.paragraphs as Array<Record<string, unknown>> | undefined
          if (paragraphs && paragraphs.length > 0) {
            const firstPara = paragraphs[0]
            if (firstPara.para_type === 1 && firstPara.text) {
              title = String(firstPara.text).substring(0, 50)
            }
          }
        }
      }
    }

    const rid = String(basic?.rid || basic?.comment_id_str || dynamicId)

    return {
      id: dynamicId,
      type: String(item.type || 'dynamic'),
      title,
      author_name: authorName,
      author_id: authorId,
      created_time: createdTime,
      stat: { like, reply, forward, favorite },
      rid,
    }
  }

  /** 专栏页面HTML */
  async getColumnPage(cvid: string): Promise<string | null> {
    try {
      const res = await this.client.get(`https://www.bilibili.com/read/cv${cvid}/`, {
        headers: { Referer: 'https://www.bilibili.com/' },
        timeout: 15000,
      })
      if (res.status === 200) return res.data as string
    } catch { /* ignore */ }
    return null
  }

  /** 专栏信息（从HTML解析） */
  async getColumnInfo(cvid: string): Promise<BiliColumnInfo | null> {
    const html = await this.getColumnPage(cvid)
    if (!html) return null

    // 提取cid
    const cidMatch = html.match(/"cid":(\d+)|cid:\s*(\d+)|"column_cid":\s*"(\d+)"/)
    const cid = cidMatch ? (cidMatch[1] || cidMatch[2] || cidMatch[3]) : ''

    // 提取标题
    const titleMatch = html.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h1>/)
    const title = titleMatch ? titleMatch[1].trim() : ''

    // 提取作者
    const authorMatch = html.match(/"name":"([^"]+)"/)
    const authorName = authorMatch ? authorMatch[1] : ''

    // 提取作者ID
    const midMatch = html.match(/"mid":(\d+)/)
    const authorId = midMatch ? Number(midMatch[1]) : 0

    // 提取发布时间
    const timeMatch = html.match(/"publish_time":(\d+)/)
    const createdTime = timeMatch ? Number(timeMatch[1]) : 0

    return {
      cvid,
      title,
      author_name: authorName,
      author_id: authorId,
      created_time: createdTime,
      like: 0,
      reply: 0,
      favorite: 0,
      cid,
    }
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
