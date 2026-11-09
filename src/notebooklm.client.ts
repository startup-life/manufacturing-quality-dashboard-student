import { BadGatewayException, Injectable } from '@nestjs/common';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

const failureMessage = 'NotebookLM 질문에 실패했습니다. 로그인과 노트북 ID를 확인하세요.';
const timeoutMessage = 'NotebookLM 응답 시간이 초과되었습니다. 자동 재시도하지 않습니다.';

interface NotebookLMResult {
  answer: string;
  sources_used: unknown[];
  status?: string;
  error_details?: { category?: string };
}

@Injectable()
export class NotebookLMClient {
  async query(question: string): Promise<{ text: string; sources: unknown[] }> {
    const command = process.env.NOTEBOOKLM_MCP_COMMAND;
    const notebookId = process.env.NOTEBOOKLM_NOTEBOOK_ID;
    if (!command || !notebookId) throw new BadGatewayException(failureMessage);

    const result = await new Promise<NotebookLMResult>((resolve, reject) => {
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          !['ONEPORT_API_KEY', 'GAS_WEBAPP_URL', 'SESSION_SECRET'].includes(key),
        ),
      ) as NodeJS.ProcessEnv;
      environment.NOTEBOOKLM_HL = 'ko';
      environment.NOTEBOOKLM_RATE_LIMIT_MAX_RETRIES = '0';

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(command, ['--transport', 'stdio'], {
          env: environment,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch {
        reject(new BadGatewayException(failureMessage));
        return;
      }

      let settled = false;
      let initialized = false;
      let timeout: NodeJS.Timeout;

      const finish = (error?: Error, value?: NotebookLMResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill();
        if (error) reject(error);
        else if (value) resolve(value);
        else reject(new BadGatewayException(failureMessage));
      };

      timeout = setTimeout(() => {
        finish(new BadGatewayException(timeoutMessage));
      }, 150_000);

      const send = (message: Record<string, unknown>) => {
        child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
          if (error) finish(new BadGatewayException(failureMessage));
        });
      };

      const readMessage = (line: string) => {
        if (!line.trim() || settled) return;
        let message: Record<string, any>;
        try {
          message = JSON.parse(line) as Record<string, any>;
        } catch {
          finish(new BadGatewayException(failureMessage));
          return;
        }

        if (message.id === 1) {
          if (message.error) {
            finish(new BadGatewayException(failureMessage));
            return;
          }
          initialized = true;
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'notebook_query', arguments: { notebook_id: notebookId, query: question } },
          });
          return;
        }

        if (message.id !== 2 || !initialized) return;
        if (message.error) {
          finish(new BadGatewayException(failureMessage));
          return;
        }
        const result = message.result ?? {};
        let content: Record<string, any> | undefined;
        if (result.structuredContent && typeof result.structuredContent === 'object') {
          content = result.structuredContent;
        } else if (Array.isArray(result.content)) {
          const text = result.content.find((item: any) => typeof item?.text === 'string')?.text;
          if (typeof text === 'string') {
            try {
              content = JSON.parse(text) as Record<string, any>;
            } catch {
              content = undefined;
            }
          }
        }
        if (!content) {
          finish(new BadGatewayException(failureMessage));
          return;
        }
        if (content.status === 'error') {
          const messageText = content.error_details?.category === 'deadline_exceeded'
            ? timeoutMessage
            : failureMessage;
          finish(new BadGatewayException(messageText));
          return;
        }
        if (typeof content.answer !== 'string' || !content.answer.trim()) {
          finish(new BadGatewayException(failureMessage));
          return;
        }
        finish(undefined, {
          answer: content.answer,
          sources_used: Array.isArray(content.sources_used) ? content.sources_used : [],
        });
      };

      const lines = createInterface({ input: child.stdout });
      child.stderr.resume();
      lines.on('line', readMessage);
      child.once('error', () => finish(new BadGatewayException(failureMessage)));
      child.once('close', () => {
        if (!settled) finish(new BadGatewayException(failureMessage));
      });

      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'tumbler-factory', version: '0.1.0' },
        },
      });
    });

    return { text: result.answer, sources: result.sources_used };
  }
}
