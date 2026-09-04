import { createClient, getJson } from './src/server/dist/crawler/client.js';
import fs from 'fs';

const OPS_ID = '1242949793748090912';

let cookie = '';
try {
  const config = JSON.parse(fs.readFileSync('app/config/cookie_config.json', 'utf-8'));
  cookie = config.bilibili || '';
} catch {}

const client = createClient(cookie);

async function test() {
  const opsData = await getJson(client, '/x/polymer/web-dynamic/v1/detail', { timezone_offset: '-480', id: OPS_ID });
  if (opsData) {
    const item = opsData.item;
    const modules = item.modules;
    
    console.log('=== module_stat ===');
    console.log(JSON.stringify(modules.module_stat, null, 2));
    
    console.log('\n=== module_author ===');
    console.log(JSON.stringify(modules.module_author, null, 2));
    
    console.log('\n=== module_dynamic ===');
    console.log(JSON.stringify(modules.module_dynamic, null, 2));
  }
}

test();
