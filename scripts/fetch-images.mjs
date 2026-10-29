import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const lock=JSON.parse(await fs.readFile(new URL('../assets/image-lock.json',import.meta.url),'utf8'));
// --from <clone 경로>: git clone으로 받은 이미지 저장소에서 복사한다.
const fromIndex=process.argv.indexOf('--from'), from=fromIndex<0?null:process.argv[fromIndex+1];
if(!from){console.error('이미지 저장소를 먼저 clone하고 그 경로를 적으세요. 예: node scripts/fetch-images.mjs --from ../manufacturing-quality-student-images');process.exit(1);}
const root=path.resolve(from);
async function readLocal(asset){
 const file=path.resolve(root,asset.source_path);
 const rel=path.relative(root,file);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('Invalid source path: '+asset.id);
 try{return await fs.readFile(file);}catch(e){if(e.code==='ENOENT')throw Error('clone에 이미지가 없습니다: '+asset.source_path+' ('+asset.id+'). 이미지 저장소 경로와 브랜치를 확인하세요.');throw e;}
}
await fs.mkdir(new URL('../runtime/images/',import.meta.url),{recursive:true});
const records=[];
for(const asset of lock.assets){
 const target=new URL('../runtime/images/'+asset.id+'.jpg',import.meta.url);
 let existing; try{existing=await fs.readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(existing){if(createHash('sha256').update(existing).digest('hex')!==asset.sha256)throw Error('Existing image hash conflict: '+asset.id);records.push({id:asset.id,sha256:asset.sha256,verified:true});continue;}
 const bytes=await readLocal(asset);
 if(bytes[0]!==255||bytes[1]!==216||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('Image verification failed: '+asset.id);
 await fs.writeFile(target,bytes,{flag:'wx'});
 records.push({id:asset.id,sha256:asset.sha256,verified:true});
 if(records.length%16===0)console.log('verified',records.length,'/',lock.assets.length);
}
await fs.writeFile(new URL('../runtime/image-verification.json',import.meta.url),JSON.stringify({commit:lock.commit,source:'local-clone',count:records.length,records},null,2));
console.log('Images verified:',records.length);
