import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import cron from "node-cron";
import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Api } from "grammy";
import { createLogger } from "./logger.js";

const log = createLogger("cron");

interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  chatId: number;
  enabled: boolean;
}

const cronsPath = resolve(import.meta.dirname, "../crons.json");
let jobs: CronJob[] = [];
const scheduledTasks = new Map<string, cron.ScheduledTask>();

function loadJobs(): CronJob[] {
  try {
    return JSON.parse(readFileSync(cronsPath, "utf-8"));
  } catch {
    return [];
  }
}

function saveJobs() {
  writeFileSync(cronsPath, JSON.stringify(jobs, null, 2));
}

export function initCrons(
  botApi: Api,
  runCronPrompt: (prompt: string, chatId: number) => Promise<string>
) {
  log.info(`Loading jobs from ${cronsPath}...`);
  jobs = loadJobs();
  log.info(`Loaded ${jobs.length} job(s) from file`);
  for (const job of jobs) {
    if (job.enabled) {
      log.debug(`Scheduling job ${job.id}: ${job.schedule}`);
      scheduleJob(job, botApi, runCronPrompt);
    }
  }
  log.info(`Initialized ${jobs.length} cron job(s)`);
}

function scheduleJob(
  job: CronJob,
  botApi: Api,
  runCronPrompt: (prompt: string, chatId: number) => Promise<string>
) {
  const task = cron.schedule(job.schedule, async () => {
    try {
      log.info(`Cron ${job.id} firing: ${job.prompt}`);
      const result = await runCronPrompt(job.prompt, job.chatId);
      await botApi.sendMessage(job.chatId, result.slice(0, 4096));
    } catch (err) {
      log.error(`Cron ${job.id} error:`, err);
    }
  });
  scheduledTasks.set(job.id, task);
}

export function createCronTools(
  chatId: number,
  botApi: Api,
  runCronPrompt: (prompt: string, chatId: number) => Promise<string>
): AgentTool<any>[] {
  return [
    {
      name: "create_cron",
      description:
        'Create a recurring scheduled task. Uses cron syntax (e.g. "0 9 * * *" for daily at 9am, "*/30 * * * *" for every 30 min).',
      parameters: Type.Object({
        schedule: Type.String({ description: "Cron schedule expression" }),
        prompt: Type.String({
          description: "The prompt to send to the AI when the cron fires",
        }),
      }),
      label: "create_cron",
      execute: async (
        _toolCallId: string,
        params: any
      ): Promise<AgentToolResult<any>> => {
        if (!cron.validate(params.schedule)) {
          return {
            content: [
              { type: "text", text: `Invalid cron expression: ${params.schedule}` },
            ],
            details: {},
          };
        }
        const job: CronJob = {
          id: Math.random().toString(36).slice(2, 8),
          schedule: params.schedule,
          prompt: params.prompt,
          chatId,
          enabled: true,
        };
        jobs.push(job);
        saveJobs();
        scheduleJob(job, botApi, runCronPrompt);
        return {
          content: [
            {
              type: "text",
              text: `Cron job created: id=${job.id}, schedule="${job.schedule}"`,
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "list_crons",
      description: "List all scheduled cron jobs.",
      parameters: Type.Object({}),
      label: "list_crons",
      execute: async (): Promise<AgentToolResult<any>> => {
        if (jobs.length === 0) {
          return {
            content: [{ type: "text", text: "No cron jobs scheduled." }],
            details: {},
          };
        }
        const list = jobs
          .map(
            (j) =>
              `- [${j.id}] ${j.schedule} | ${j.enabled ? "enabled" : "disabled"} | "${j.prompt}"`
          )
          .join("\n");
        return { content: [{ type: "text", text: list }], details: {} };
      },
    },
    {
      name: "delete_cron",
      description: "Delete a scheduled cron job by its ID.",
      parameters: Type.Object({
        id: Type.String({ description: "The cron job ID to delete" }),
      }),
      label: "delete_cron",
      execute: async (
        _toolCallId: string,
        params: any
      ): Promise<AgentToolResult<any>> => {
        const idx = jobs.findIndex((j) => j.id === params.id);
        if (idx === -1) {
          return {
            content: [{ type: "text", text: `Cron job ${params.id} not found.` }],
            details: {},
          };
        }
        const task = scheduledTasks.get(params.id);
        if (task) {
          task.stop();
          scheduledTasks.delete(params.id);
        }
        jobs.splice(idx, 1);
        saveJobs();
        return {
          content: [{ type: "text", text: `Cron job ${params.id} deleted.` }],
          details: {},
        };
      },
    },
  ];
}
