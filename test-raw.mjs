import { createClient, getJson } from './src/server/dist/crawler/client.js';
import fs from 'fs';

const OPS_ID = '1242949793748090912';
const DYNAMIC_ID = '1243043748304125956';

let cookie = '';
try {
  const config = JSON.parse(fs.readFileSync('app/config/cookie_config.json', 'utf-8'));
  cookie = config.bilibili || '';
} catch {}

const client = createClient(cookie);

async function test() {
  console.log('=== OPS 动态原始数据 ===');
  const opsData = await getJson(client, '/x/polymer/web-dynamic/v1/detail', { timezone_offset: '-480', id: OPS_ID });
  if (opsData) {
    const item = opsData.item;
    console.log('item.type:', item.type);
    console.log('item.modules keys:', Object.keys(item.modules || {}));
    console.log('modules格式:', Array.isArray(item.modules) ? 'Array' : 'Object');
    if (Array.isArray(item.modules)) {
      console.log('modules[0]:', JSON.stringify(item.modules[0], null, 2));
    } else {
      console.log('MODULE_TYPE_STAT:', JSON.stringify(item.modules?.MODULE_TYPE_STAT, null, 2));
      console.log('MODULE_TYPE_AUTHOR:', JSON.stringify(item.modules?.MODULE_TYPE_AUTHOR, null, 2));
    }
  }

  console.log('\n=== 普通动态原始数据 ===');
  const dynData = await getJson(client, '/x/polymer/web-dynamic/v1/detail', { timezone_offset: '-480', id: DYNAMIC_ID });
  if (dynData) {
    const item = dynData.item;
    console.log('item.type:', item.type);
    console.log('item.modules keys:', Object.keys(item.modules || {}));
    console.log('modules格式:', Array.isArray(item.modules) ? 'Array' : 'Object');
    if (Array.isArray(item.modules)) {
      console.log('modules length:', item.modules.length);
      for (const m of item.modules) {
        console.log('module_type:', m.module_type);
      }
    }
  }
}

test();
