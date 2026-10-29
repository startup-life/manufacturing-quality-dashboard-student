import fs from 'node:fs/promises';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const lock=JSON.parse(await fs.readFile(new URL('../assets/image-lock.json',import.meta.url),'utf8')),seen=new Set(),counts={};const files=[];
for(const asset of lock.assets){const file=new URL('../runtime/images/'+asset.id+'.jpg',import.meta.url);const bytes=await fs.readFile(file);const sha=crypto.createHash('sha256').update(bytes).digest('hex');if(sha!==asset.sha256||seen.has(sha))throw Error('Hash or duplicate error: '+asset.id);if(bytes[0]!==255||bytes[1]!==216)throw Error('Not JPEG');seen.add(sha);counts[asset.split]=(counts[asset.split]||0)+1;files.push(decodeURIComponent(file.pathname));}
if(seen.size!==128||Object.values(counts).some(n=>n!==64))throw Error('Image count mismatch');
const metadata=spawnSync('sips',['-g','pixelWidth','-g','pixelHeight',...files],{encoding:'utf8',maxBuffer:1024*1024});
if(metadata.status===0){const sizes=[...metadata.stdout.matchAll(/pixel(?:Width|Height): (\d+)/g)].map(x=>Number(x[1]));if(sizes.length!==256||sizes.some(x=>x!==1024))throw Error('Expected 128 × 1024px square JPEG');}
else console.log('Dimension check unavailable: run on macOS with sips or verify dimensions on classroom PC.');
console.log(JSON.stringify({unique_images:seen.size,counts,dimensions_checked:metadata.status===0}));
