import { BilibiliAPI } from './src/server/dist/crawler/bilibili.js';
import fs from 'fs';

const OPS_ID = '1242949793748090912';
const DYNAMIC_ID = '1243043748304125956';

// 读取cookie
let cookie = '';
try {
  const config = JSON.parse(fs.readFileSync('app/config/cookie_config.json', 'utf-8'));
  cookie = config.bilibili || '';
} catch {}

const api = new BilibiliAPI(cookie);

async function test() {
  console.log('=== 测试 OPS 动态 ===');
  console.log('ID:', OPS_ID);
  try {
    const ops = await api.getDynamicDetail(OPS_ID);
    console.log('新版API结果:', JSON.stringify(ops, null, 2));
    if (!ops) {
      console.log('尝试旧版API...');
      const opsOld = await api.getDynamicDetailOld(OPS_ID);
      console.log('旧版API结果:', JSON.stringify(opsOld, null, 2));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }

  console.log('\n=== 测试普通动态 ===');
  console.log('ID:', DYNAMIC_ID);
  try {
    const dyn = await api.getDynamicDetail(DYNAMIC_ID);
    console.log('新版API结果:', JSON.stringify(dyn, null, 2));
    if (!dyn) {
      console.log('尝试旧版API...');
      const dynOld = await api.getDynamicDetailOld(DYNAMIC_ID);
      console.log('旧版API结果:', JSON.stringify(dynOld, null, 2));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

test();
