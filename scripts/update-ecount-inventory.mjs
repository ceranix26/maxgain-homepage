import fs from 'node:fs/promises';

const required = ['ECOUNT_COM_CODE','ECOUNT_USER_ID','ECOUNT_API_CERT_KEY','ECOUNT_ZONE'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);

const COM_CODE = process.env.ECOUNT_COM_CODE;
const USER_ID = process.env.ECOUNT_USER_ID;
const API_CERT_KEY = process.env.ECOUNT_API_CERT_KEY;
const ZONE = process.env.ECOUNT_ZONE;
const MODE = (process.env.ECOUNT_API_MODE || 'prod').toLowerCase();
const HOST_PREFIX = MODE === 'test' ? 'sboapi' : 'oapi';
const host = `https://${HOST_PREFIX}${ZONE}.ecount.com`;
const baseDate = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');

async function post(url, body) {
  const response = await fetch(url, {method:'POST',headers:{'Accept':'application/json','Content-Type':'application/json'},body:JSON.stringify(body)});
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${url}: ${text.slice(0,500)}`);
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON response from ${url}: ${text.slice(0,500)}`); }
  return data;
}

function deepFind(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj,key)) return obj[key];
  for (const value of Object.values(obj)) { const found=deepFind(value,key); if (found!==undefined) return found; }
}

function collectInventoryRows(node, output=[]) {
  if (Array.isArray(node)) {
    for (const item of node) collectInventoryRows(item,output);
  } else if (node && typeof node === 'object') {
    const code = node.PROD_CD ?? node.PROD_CODE ?? node.ITEM_CD;
    const qty = node.BAL_QTY ?? node.BALANCE_QTY ?? node.QTY;
    if (code != null && qty != null) output.push({partNumber:String(code).trim(),quantity:Number(String(qty).replaceAll(',',''))||0});
    for (const value of Object.values(node)) collectInventoryRows(value,output);
  }
  return output;
}

const login = await post(`${host}/OAPI/V2/OAPILogin`, {COM_CODE,USER_ID,ZONE,API_CERT_KEY,LAN_TYPE:'ko-KR'});
const sessionId = deepFind(login,'SESSION_ID');
if (!sessionId) throw new Error(`SESSION_ID not found: ${JSON.stringify(login).slice(0,1000)}`);

const inventory = await post(`${host}/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatusByLocation?SESSION_ID=${encodeURIComponent(sessionId)}`, {
  SESSION_ID:sessionId, BASE_DATE:baseDate, COM_CODE, USER_ID, ZONE, API_CERT_KEY, LAN_TYPE:'ko-KR'
});
const rows = collectInventoryRows(inventory);
if (!rows.length) throw new Error(`No inventory rows found. Verify the ECOUNT response schema and account permissions.`);

const totals = new Map();
for (const row of rows) totals.set(row.partNumber,(totals.get(row.partNumber)||0)+row.quantity);
const items = Object.fromEntries([...totals.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([partNumber,quantity])=>[partNumber,{status:quantity>0?'in-stock':'out-of-stock',label:quantity>0?'재고 있음':'재고 없음'}]));
const output = {updatedAt:new Date().toISOString(),baseDate,source:'ECOUNT',items};
await fs.mkdir('data',{recursive:true});
await fs.writeFile('data/inventory-status.json',JSON.stringify(output,null,2)+'\n','utf8');
console.log(`Updated ${Object.keys(items).length} inventory statuses for ${baseDate}.`);
