/**
 * Local NotebookLM MCP Client: options.command, NOTEBOOKLM_MCP_COMMAND, or Antigravity's identical MCP configuration
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callNotebookTool } from './mcp-stdio';
import { setupError } from './validation';
import { promptCore } from './prompt-core';

type Env = Record<string, string | undefined>;
export type LaunchOptions = { command?: string; args?: string[]; home?: string };
type QueryInput = { inspectionId: string; draftId: unknown; productName?: string; standardRevision?: string; contentVersion?: number; prompt?: { text?: string } | null; weightG?: number | null };
export type McpLaunch = { source: string | null; command: string | null; args: string[]; env: Record<string, string>; configLabel?: string; configError?: string | null };

const DEFAULT_MCP_ARGS = ['--transport', 'stdio'];
// Antigravity가 쓰는 MCP 설정 파일과 같은 항목을 읽어 같은 실행 파일을 띄운다(비전 리스크 과정과 같은 순서·위치).
const ANTIGRAVITY_SERVER_NAME = 'gemini-notebook-mcp';
// Antigravity 문서의 전역 설정 위치가 앞, `nlm setup add antigravity`(notebooklm-mcp-cli)가 쓰는 위치가 뒤다.
// Antigravity가 실제로 어느 파일을 읽는지는 확인하지 못해 둘 다 본다.
const ANTIGRAVITY_CONFIGS = ['config', 'antigravity'].map(dir => ({ label: `~/.gemini/${dir}/mcp_config.json`, parts: ['.gemini', dir, 'mcp_config.json'] }));
const ANTIGRAVITY_CONFIG_LABEL = ANTIGRAVITY_CONFIGS[0].label;
const NOT_CONFIGURED = `환경 변수 NOTEBOOKLM_MCP_COMMAND를 지정하거나 ${ANTIGRAVITY_CONFIGS.map(c => c.label).join(' 또는 ')}에 ${ANTIGRAVITY_SERVER_NAME} 항목을 등록하세요(세 곳 모두 확인했습니다).`;

/**
 * MCP 실행 방법을 정한다. 순서: options.command, 환경 변수 NOTEBOOKLM_MCP_COMMAND, ~/.gemini/config, ~/.gemini/antigravity의 mcp_config.json.
 * 앞의 것이 있으면 뒤의 것은 읽지 않는다. options.home은 테스트가 실제 홈 설정을 읽지 않게 하는 데 쓴다.
 * 앞 파일을 읽지 못해도 뒤 파일은 확인하고, 읽지 못한 이유는 configError로 함께 돌려준다.
 * 어디에도 없으면 command가 null인 "설정 안 됨" 상태를 돌려준다.
 */
export function resolveMcpLaunch(options: LaunchOptions = {}, env: Env = process.env): McpLaunch {
  if (options.command) return { source: 'options', command: options.command, args: options.args || DEFAULT_MCP_ARGS, env: {} };
  if (env.NOTEBOOKLM_MCP_COMMAND) return { source: 'NOTEBOOKLM_MCP_COMMAND', command: env.NOTEBOOKLM_MCP_COMMAND, args: options.args || DEFAULT_MCP_ARGS, env: {} };
  const home = options.home || os.homedir();
  const errors: string[] = [];
  for (const config of ANTIGRAVITY_CONFIGS) {
    const file = path.join(home, ...config.parts);
    try {
      if (!fs.existsSync(file)) continue;
      const entry = JSON.parse(fs.readFileSync(file, 'utf8'))?.mcpServers?.[ANTIGRAVITY_SERVER_NAME];
      if (entry && typeof entry.command === 'string' && entry.command) {
        return { source: 'antigravity', configLabel: config.label, command: entry.command, args: options.args || (Array.isArray(entry.args) ? entry.args.map(String) : []), env: entry.env && typeof entry.env === 'object' ? { ...entry.env } : {}, ...(errors.length ? { configError: errors.join('; ') } : {}) };
      }
    } catch (e: any) {
      // JSON.parse 오류 문구에는 파일 내용 일부가 들어가므로(env 값 포함 가능) 종류만 붙인다.
      errors.push(`${config.label}을 읽을 수 없습니다: ${e instanceof SyntaxError ? 'JSON 형식이 올바르지 않습니다' : e.code || e.name}`);
    }
  }
  return { source: null, command: null, args: options.args || DEFAULT_MCP_ARGS, env: {}, configError: errors.length ? errors.join('; ') : null };
}

export function describeLaunchSource(source: string | null, configLabel = ANTIGRAVITY_CONFIG_LABEL) {
  if (source === 'options') return '생성자 옵션 command';
  if (source === 'NOTEBOOKLM_MCP_COMMAND') return '환경 변수 NOTEBOOKLM_MCP_COMMAND';
  if (source === 'antigravity') return `${configLabel}의 ${ANTIGRAVITY_SERVER_NAME}`;
  return '설정 없음';
}

export function mcpNotConfiguredMessage(configError?: string | null) {
  return `NotebookLM MCP 실행 방법이 설정되지 않았습니다. ${NOT_CONFIGURED}${configError ? ` (${configError})` : ''}`;
}

const NOTEBOOK_ID = /^[a-f0-9-]{36}$/i;
// Time limits for one live query. NotebookLM gets NOTEBOOK_QUERY_SECONDS (notebook_query's timeout; the tool's own
// default is 120 s); the whole MCP call, with the process start, initialize and tools/list, gets MCP_CALL_MS.
// 2026-10-20 live queries took 40-59 s from the click to the answer, GAS reads and the save included, so the query
// gets the tool's default and the call 15 s more for the process. Nothing in between stops sooner: the route and the
// screen set no limit, the Node server keeps no response timeout, and each GAS call has its own 380 s
// (src/gas-transport.ts).
export const NOTEBOOK_QUERY_SECONDS = 120;
export const MCP_CALL_MS = 135000;
const NOTEBOOK_ID_MISSING = '교육용 NotebookLM 노트북 ID를 설정하세요.';

const isPathLike = (command: string) => path.isAbsolute(command) || command.includes('/') || command.includes('\\');

/**
 * 실행 전에 막을 수 있는 문제를 돌려준다. 없으면 null.
 * 경로 형태면 파일이 있어야 하고, 명령 이름이면 PATH 해석은 실행 시점에 맡긴다.
 * spawn(shell:false)은 Windows에서 .cmd·.bat를 실행하지 못하므로(EINVAL) 미리 안내한다.
 */
export function checkMcpCommand(launch: McpLaunch & { command: string }, platform: string = process.platform) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(launch.command)) return `${describeLaunchSource(launch.source, launch.configLabel)}: Windows에서는 .cmd·.bat를 직접 실행할 수 없습니다. 실행 파일(.exe) 경로를 지정하세요.`;
  if (isPathLike(launch.command) && !fs.existsSync(launch.command)) return `${describeLaunchSource(launch.source, launch.configLabel)}에 지정한 NotebookLM MCP 실행 파일이 없습니다. 경로를 확인하세요.`;
  return null;
}

// The notebook's sources are standards/notebooklm-<revision>.md (docs/NOTEBOOKLM_MCP.md), and notebook_query answers name
// sources by ID only. An answer citing at least one source (sources, citations or references) gets the queried standard's
// name from those files; without a citation, or when the files cannot be read, the name stays unknown ('').
export function citedStandardName({ sources, citations, references }: { sources?: unknown; citations?: unknown; references?: unknown } = {}, revision: string) {
  const cited = [sources, references].some(x => Array.isArray(x) && x.length > 0) || (!!citations && typeof citations === 'object' && Object.keys(citations).length > 0);
  if (!cited || !['Rev.A', 'Rev.B'].includes(revision)) return '';
  const dir = __dirname;
  try {
    const title = JSON.parse(fs.readFileSync(path.resolve(dir, `../standards/${revision}.json`), 'utf8')).title;
    const number = /문서번호:\s*([A-Z0-9-]+)/.exec(fs.readFileSync(path.resolve(dir, `../standards/notebooklm-${revision}.md`), 'utf8'))?.[1];
    return typeof title === 'string' && title && number ? `${title} (${number} ${revision})` : '';
  } catch { return ''; } // An unreadable file leaves the name unknown; the screen then says so.
}

export class NotebookLmMcpClient {
  mode: string;
  launchOptions: LaunchOptions;
  envOverrides: Record<string, string>;
  platform: string;
  notebookId: string;
  liveVerified: boolean;
  activeQueryLock: Set<string>;

  constructor(options: LaunchOptions & { mode?: string; env?: Record<string, string>; platform?: string; notebookId?: string } = {}) {
    // The app passes its NOTEBOOKLM_MODE here (src/integrations.ts); off never reaches a query.
    this.mode = options.mode || 'mock';
    if (!['live', 'mock'].includes(this.mode)) throw new Error(`NotebookLM MCP 클라이언트 모드는 live 또는 mock입니다: ${this.mode}`);
    this.launchOptions = { command: options.command, args: options.args, home: options.home };
    this.envOverrides = options.env || {};
    this.platform = options.platform || process.platform;
    this.notebookId = options.notebookId || process.env.NOTEBOOKLM_NOTEBOOK_ID || '';
    this.liveVerified = false;
    this.activeQueryLock = new Set();
  }

  getStatus() {
    const launch = resolveMcpLaunch(this.launchOptions);
    const commandError = launch.command ? checkMcpCommand(launch as McpLaunch & { command: string }, this.platform) : null;

    // According to ARCHITECTURE.md, live user session/notebook profile is not yet certified.
    // If not certified, status MUST be '연결 준비 필요' (needs_preparation)
    const liveReady = this.mode === 'live' && !!launch.command && !commandError && !!this.notebookId && this.liveVerified;
    const name = launch.command ? path.basename(launch.command) : null;

    return {
      server_name: ANTIGRAVITY_SERVER_NAME,
      config_path: launch.configLabel || ANTIGRAVITY_CONFIG_LABEL,
      config_detected: !!launch.command,
      command: name,
      binary_path: name || 'notebooklm-mcp', // 절대경로는 내보내지 않는다. 설정이 없으면 찾아야 할 실행 파일 이름만 보여 준다
      binary_installed: !!launch.command && !commandError, // 명령 이름은 실행할 때 PATH로 확인된다
      transport: launch.args?.[1] || 'stdio',
      status: liveReady ? 'CONNECTED' : '연결 준비 필요',
      connected: liveReady,
      needs_preparation: !liveReady,
      message: liveReady
        ? 'NotebookLM MCP 서버가 연결되었습니다.'
        : !launch.command ? mcpNotConfiguredMessage(launch.configError)
        : commandError || `${describeLaunchSource(launch.source, launch.configLabel)} 설정이 감지되었으나 실제 사용자 인증 세션/교재 노트북 연동이 확인되지 않아 연결 준비가 필요합니다.${launch.configError ? ` (${launch.configError})` : ''}`,
      allowed_tools: ['notebook_query'],
      available_tools: ['notebook_query', 'source_get_content', 'chat_export'],
      scope: '교육용 품질 기준 대조; 임의 명령 실행 차단'
    };
  }

  // What would stop a live query before it starts (launch method or notebook ID), or null. Checked without running MCP.
  liveProblem() {
    const launch = resolveMcpLaunch(this.launchOptions);
    if (!launch.command) return mcpNotConfiguredMessage(launch.configError);
    const commandError = checkMcpCommand(launch as McpLaunch & { command: string }, this.platform);
    if (commandError) return commandError;
    if (!NOTEBOOK_ID.test(this.notebookId)) return NOTEBOOK_ID_MISSING;
    return null;
  }

  async queryEvidence({ inspectionId, draftId, productName, standardRevision = 'Rev.A', contentVersion = 1, prompt = null, weightG = null }: QueryInput) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(inspectionId || '')) {
      throw new Error('유효하지 않은 검사 ID 형식입니다. 명령 주입 차단.');
    }
    if (productName && /[;`$|&><]/.test(productName)) {
      throw new Error('유효하지 않은 제품명 형식입니다. 명령 주입 차단.');
    }

    if (this.activeQueryLock.has(inspectionId)) {
      const err: any = new Error('해당 검사에 대해 이미 근거 확인 질의가 진행 중입니다. 잠시 후 다시 확인하세요.');
      err.code = 'CONFLICT';
      throw err;
    }

    this.activeQueryLock.add(inspectionId);
    try {
      if (this.mode === 'live') {
        return await this._callLiveMcpQuery({ inspectionId, draftId, productName, standardRevision, contentVersion, prompt, weightG });
      }

      // Faithful Mock / Educational Verification Response
      const mock=await this._callMockMcpQuery({ inspectionId, draftId, productName, standardRevision, contentVersion });
      return {...mock,prompt};
    } finally {
      this.activeQueryLock.delete(inspectionId);
    }
  }

  async _callMockMcpQuery({ inspectionId, draftId, productName, standardRevision = 'Rev.A', contentVersion }: QueryInput) {
    await new Promise(r => setTimeout(r, 50));

    let standardData = {
      visual: '명확한 스크래치·찍힘·라벨 오정렬·뚜껑 들뜸은 NG. 가림·반사·해상도 부족으로 단정할 수 없으면 HOLD. 사진으로 누수·중량·라벨 문구 적합성을 확정하지 않는다.',
      action: 'NG/HOLD → 작업중지 권고 → 관리자 확인(시뮬레이션). 설비 제어 및 출하 승인 없음.'
    };
    try {
      const stdPath = path.resolve(__dirname, `../standards/${standardRevision}.json`);
      if (fs.existsSync(stdPath)) {
        standardData = JSON.parse(fs.readFileSync(stdPath, 'utf8'));
      }
    } catch (_) {}

    return {
      query_id: `QRY-${inspectionId}-${Date.now()}`,
      inspection_id: inspectionId,
      draft_id: draftId,
      content_version: contentVersion,
      standard_revision: standardRevision,
      notebook_id: 'nb-tumbler-standards-2026',
      source_id: `src-tumbler-standards-${standardRevision.toLowerCase()}`,
      source_document: `텀블러 제조 품질 관리 표준서 (${standardRevision})`,
      query_prompt: `${productName || '텀블러'} 제품의 ${standardRevision} 기준에서 [외관 규격] 판정 기준 및 허용 오차는 어떻게 되나요?`,
      query_text: `${productName || '텀블러'} 제품의 ${standardRevision} 기준에서 [외관 규격] 판정 기준 및 허용 오차는 어떻게 되나요?`,
      response_text: `[${standardRevision} 표준서 기준 인용] ${standardData.visual}\n조치 기준: ${standardData.action}`,
      evidence_excerpt: `${standardRevision} 표준서 원문: "${standardData.visual}" (출하 승인 없음, 담당자 대조 확인 필요)`,
      sources: [
        {
          source_id: `standards-${standardRevision.toLowerCase()}`,
          title: `교육용 텀블러 검사기준 (${standardRevision})`,
          section: '외관 및 중량 검사 기준',
          quote: standardData.visual
        }
      ],
      status: 'EXTRACTED_UNVERIFIED',
      queried_at: new Date().toISOString(),
      is_mock: true,
      notice: '로컬 모의 응답입니다. 실제 NotebookLM 연결 준비가 필요하며 담당자의 대조 확인이 필요합니다.'
    };
  }

  async _callLiveMcpQuery({ inspectionId, draftId, productName, standardRevision, contentVersion, prompt, weightG }: QueryInput & { standardRevision: string }) {
    if(!NOTEBOOK_ID.test(this.notebookId))throw setupError(NOTEBOOK_ID_MISSING,'NOTEBOOK_ID_MISSING');
    if(!['Rev.A','Rev.B'].includes(standardRevision))throw Error('지원하지 않는 검사기준 버전입니다.');
    const launch=resolveMcpLaunch(this.launchOptions);
    if(!launch.command)throw setupError(mcpNotConfiguredMessage(launch.configError),'MCP_NOT_CONFIGURED');
    const commandError=checkMcpCommand(launch as McpLaunch & { command: string },this.platform);if(commandError)throw setupError(commandError,'MCP_COMMAND_INVALID');
    const config={command:launch.command as string,args:launch.args,env:launch.env,envOverrides:this.envOverrides};
    if(!prompt?.text)throw Error('저장된 근거 질문을 선택하세요.');
    const context=promptCore.naturalInspection({product_name:productName,weight_g:weightG,standard_revision:standardRevision});
    const query=[promptCore.NOTEBOOK_SAFETY,'[근거 질문]',prompt.text,'[검사 정보]',context,promptCore.notebookSourceReference(standardRevision)].join('\n\n');
    let response: any;
    try{response=await callNotebookTool(config,{notebook_id:this.notebookId,query,timeout:NOTEBOOK_QUERY_SECONDS},{timeout:MCP_CALL_MS});this.liveVerified=true;}
    catch(err: any){if(err.code!=='MCP_QUERY_DEADLINE')this.liveVerified=false;throw err;} // NotebookLM answering late still answered
    return {query_id:`QRY-${inspectionId}-${Date.now()}`,inspection_id:inspectionId,draft_id:draftId,content_version:contentVersion,standard_revision:standardRevision,prompt,notebook_id:this.notebookId,source_document:citedStandardName({sources:response.sources_used,citations:response.citations,references:response.references},standardRevision),query_text:query,response_text:response.answer,evidence_excerpt:response.answer,sources:response.sources_used||[],citations:response.citations||{},references:response.references||[],status:'EXTRACTED_UNVERIFIED',queried_at:new Date().toISOString(),is_mock:false,notice:'실제 NotebookLM 응답입니다. 출처 원문과 담당자의 대조 확인이 필요합니다.'};
  }
}
