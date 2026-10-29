import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {setupError} from './validation';

type Env = Record<string, string | undefined>;
export type McpConfig = { command: string; args?: string[]; env?: Record<string, string>; envOverrides?: Record<string, string> };

// MCP SDK stdio의 DEFAULT_INHERITED_ENV_VARS와 같은 목록이다(@modelcontextprotocol/sdk client/stdio.js). 이 저장소는 SDK를 쓰지 않아 상수로 둔다.
const SDK_INHERITED_ENV: Record<string, string[]>={win32:['APPDATA','HOMEDRIVE','HOMEPATH','LOCALAPPDATA','PATH','PROCESSOR_ARCHITECTURE','SYSTEMDRIVE','SYSTEMROOT','TEMP','USERNAME','USERPROFILE','PROGRAMFILES'],other:['HOME','LOGNAME','PATH','SHELL','TERM','USER']};
const EXTRA_INHERITED_ENV=['TMPDIR','TMP','LANG','LC_ALL','LC_CTYPE','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy'];
// 비전 리스크 과정과 같은 고정값: 한국어 응답, 한도 초과 시 자동 재시도 없음, 화면 없는 로그인 갱신 없음.
// The app's own switches (src/integrations.ts) mean nothing to the MCP server.
const APP_SWITCHES=['NOTEBOOKLM_MODE','NOTEBOOKLM_MCP_MODE'];
const FIXED_MCP_ENV={NOTEBOOKLM_HL:'ko',NOTEBOOKLM_RATE_LIMIT_MAX_RETRIES:'0',NOTEBOOKLM_DISABLE_HEADLESS_REFRESH:'1'};
/**
 * MCP 자식 프로세스 환경. 서버 비밀(SESSION_SECRET·GEMINI_API_KEY 등)은 넘기지 않는다.
 * 뒤의 것이 앞의 것을 덮는다: SDK 기본 목록, 부모의 NOTEBOOKLM_*(앱 스위치 제외), 임시 폴더·언어·프록시, 설정 파일 env, 고정값, 생성자 옵션 env.
 */
export function buildMcpEnv(launchEnv: Record<string, string>={},overrides: Record<string, string>={},env: Env=process.env,platform: string=process.platform){
  const pick=(keys: string[]): Record<string, string>=>Object.fromEntries(keys.filter(k=>typeof env[k]==='string').map(k=>[k,env[k] as string]));
  const inherited=Object.fromEntries(Object.entries(pick(SDK_INHERITED_ENV[platform==='win32'?'win32':'other'])).filter(([,v])=>!v.startsWith('()'))); // 셸 함수 값은 SDK처럼 뺀다
  return {...inherited,...pick(Object.keys(env).filter(k=>k.startsWith('NOTEBOOKLM_')&&!APP_SWITCHES.includes(k))),...pick(EXTRA_INHERITED_ENV),...launchEnv,...FIXED_MCP_ENV,...overrides};
}

const TIMEOUT_MESSAGE='NotebookLM 응답 시간이 초과되었습니다. 자동 재시도하지 않습니다.';
// One bounded session per query; never execute a shell or log authentication data.
export async function callNotebookTool(config: McpConfig, args: Record<string, unknown>, {timeout=45000,exitGrace=2000}={}): Promise<any> {
  const child=spawn(config.command,config.args||[],{shell:false,stdio:['pipe','pipe','pipe'],env:buildMcpEnv(config.env,config.envOverrides)});
  const pending=new Map<number,{resolve:(value: any)=>void;reject:(reason: unknown)=>void}>();let nextId=1,stopped=false,exited=false,stdinTimer: NodeJS.Timeout|undefined;
  // The failure code (spawn errno, exit code or signal) stays on the error for the server log; stderr text does not.
  const fail=(code: string)=>{for(const p of pending.values())p.reject(setupError('NotebookLM MCP 실행 또는 응답에 실패했습니다. 인증 상태를 확인하세요.',code));pending.clear();};
  child.on('error',(e: NodeJS.ErrnoException)=>fail(e.code||'MCP_SPAWN_FAILED'));child.on('exit',(code,signal)=>{exited=true;clearTimeout(stdinTimer);if(!stopped)fail(signal?'MCP_SIGNAL_'+signal:'MCP_EXIT_'+code);});
  child.stderr.on('data',()=>{}); // Provider logs can contain account information.
  // A child that exits closes its stdin first, so EPIPE usually arrives before the exit event. Wait briefly for the
  // exit code, which says more; fall back to the stdin error if the child keeps running.
  child.stdin.on('error',(e: NodeJS.ErrnoException)=>{if(stopped||exited||stdinTimer)return;stdinTimer=setTimeout(()=>fail(e.code||'MCP_STDIN_FAILED'),exitGrace);});
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
    let value: any;try{value=JSON.parse(line);}catch{return;}
    if(value.method&&value.id!==undefined){child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:value.id,error:{code:-32601,message:'Client requests are not supported'}})+'\n');return;}
    const request=pending.get(value.id);if(!request)return;
    pending.delete(value.id);
    if(value.error)request.reject(Object.assign(Error('NotebookLM MCP 요청이 거절되었습니다.'),{code:'MCP_RPC_'+value.error.code}));
    else request.resolve(value.result);
  });
  const request=(method: string,params: Record<string, unknown>)=>new Promise<any>((resolve,reject)=>{
    const id=nextId++;pending.set(id,{resolve,reject});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
  let timer: NodeJS.Timeout|undefined;
  try{
    return await Promise.race([(async()=>{
      await request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'tumbler-quality-dashboard',version:'1.0.0'}});
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
      const tools=await request('tools/list',{});
      if(!tools?.tools?.some((t: any)=>t.name==='notebook_query'))throw Object.assign(Error('NotebookLM 질의 도구가 제공되지 않습니다.'),{code:'MCP_TOOL_MISSING'});
      const result=await request('tools/call',{name:'notebook_query',arguments:args});
      if(result?.isError)throw setupError('NotebookLM 질의 실패: 인증·한도·노트북 접근 권한을 확인하세요.','MCP_TOOL_ERROR');
      let data=result?.structuredContent;
      if(!data){const text=result?.content?.filter((c: any)=>c.type==='text').map((c: any)=>c.text).join('\n');try{data=JSON.parse(text);}catch{throw Object.assign(Error('NotebookLM 응답 형식이 올바르지 않습니다.'),{code:'MCP_RESPONSE_FORMAT'});}}
      if(data?.status==='error' && /auth.*expir|credentials.*expir|re-authenticate/i.test(String(data.error||'')))throw setupError('NotebookLM 인증이 만료되었습니다. 기존 MCP 프로필을 재인증해 주세요. Gemini 판독 결과는 유지됩니다.','MCP_AUTH_EXPIRED');
      // NotebookLM's own query budget ran out (notebooklm-mcp-cli services/chat.py): the MCP server answered, so it is a timeout, not a connection failure.
      if(data?.status==='error'&&data.error_details?.category==='deadline_exceeded')throw setupError(TIMEOUT_MESSAGE,'MCP_QUERY_DEADLINE');
      if(data?.status==='error'||typeof data?.answer!=='string'||!data.answer.trim())throw setupError('NotebookLM이 유효한 답변을 반환하지 않았습니다. 연결 상태와 노트북 접근 권한을 확인하세요.','MCP_NO_ANSWER');
      return data;
    })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(setupError(TIMEOUT_MESSAGE,'MCP_TIMEOUT')),timeout);})]);
  }finally{clearTimeout(timer);clearTimeout(stdinTimer);stopped=true;fail('MCP_STOPPED');lines.close();child.stdin.end();child.kill('SIGTERM');const kill=setTimeout(()=>child.kill('SIGKILL'),2000);kill.unref();child.once('exit',()=>clearTimeout(kill));}
}
