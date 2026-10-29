import fs from 'node:fs';

// node --env-file은 BOM을 첫 키 이름의 일부로 읽어 첫 키(첫 줄이 주석이면 그다음 키)를 조용히 잃는다.
// 파싱은 Node에 맡기고, 메모장 등으로 BOM이 붙은 파일만 시작 전에 막는다. 파일이 없으면 null.
export function envFileBomError(file: fs.PathLike) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
  try {
    const head = Buffer.alloc(3);
    const read = fs.readSync(fd, head, 0, 3, 0);
    return read === 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf
      ? '.env 파일이 BOM이 붙은 UTF-8로 저장돼 있습니다. UTF-8(BOM 없음)으로 다시 저장하세요.'
      : null;
  } finally { fs.closeSync(fd); }
}
