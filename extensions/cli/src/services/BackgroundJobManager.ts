import { logger } from "../util/logger.js";

import { BaseService } from "./BaseService.js";

export type BackgroundJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface BackgroundJob {
  id: string;
  status: BackgroundJobStatus;
  command: string;
  output: string;
  exitCode: number | null;
  startTime: Date;
  endTime: Date | null;
}

export interface BackgroundJobServiceState {
  jobs: Record<string, BackgroundJob>;
  nextId: number;
}

const MAX_CONCURRENT_JOBS = 5;

export class BackgroundJobManager extends BaseService<BackgroundJobServiceState> {
  private killHandlers = new Map<string, () => void | Promise<void>>();

  constructor() {
    super("BackgroundJobManager", {
      jobs: {},
      nextId: 0,
    });
    this.setMaxListeners(50);
  }

  async doInitialize(): Promise<BackgroundJobServiceState> {
    return { ...this.currentState };
  }

  private getActiveJobs(): BackgroundJob[] {
    return Object.values(this.currentState.jobs).filter(
      (job) => job.status === "pending" || job.status === "running",
    );
  }

  createJob(command: string): BackgroundJob {
    const activeJobs = this.getActiveJobs();
    if (activeJobs.length >= MAX_CONCURRENT_JOBS) {
      throw new Error(
        `Maximum of ${MAX_CONCURRENT_JOBS} background jobs reached`,
      );
    }

    const id = String(this.currentState.nextId + 1);
    const now = new Date();

    const job: BackgroundJob = {
      id,
      status: "pending",
      command,
      output: "",
      exitCode: null,
      startTime: now,
      endTime: null,
    };

    this.setState({
      jobs: {
        ...this.currentState.jobs,
        [id]: job,
      },
      nextId: this.currentState.nextId + 1,
    });

    logger.debug("Created background job", { id, command });

    return job;
  }

  updateJobOutput(jobId: string, chunk: string): void {
    const job = this.currentState.jobs[jobId];
    if (!job) {
      return;
    }

    const updated: BackgroundJob = {
      ...job,
      status: job.status === "pending" ? "running" : job.status,
      output: job.output + chunk,
    };

    this.setState({
      jobs: {
        ...this.currentState.jobs,
        [jobId]: updated,
      },
    });
  }

  completeJob(
    jobId: string,
    exitCode: number | null,
    extraOutput?: string,
  ): void {
    const job = this.currentState.jobs[jobId];
    if (!job) {
      return;
    }

    const output = extraOutput ? job.output + extraOutput : job.output;

    const updated: BackgroundJob = {
      ...job,
      status:
        exitCode === null || exitCode === 0 || job.status === "completed"
          ? "completed"
          : "failed",
      output,
      exitCode,
      endTime: new Date(),
    };

    this.killHandlers.delete(jobId);

    this.setState({
      jobs: {
        ...this.currentState.jobs,
        [jobId]: updated,
      },
    });
  }

  failJob(jobId: string, errorOutput: string, exitCode?: number | null): void {
    const job = this.currentState.jobs[jobId];
    if (!job) {
      return;
    }

    const updated: BackgroundJob = {
      ...job,
      status: "failed",
      output: job.output + errorOutput,
      exitCode: exitCode ?? job.exitCode,
      endTime: new Date(),
    };

    this.killHandlers.delete(jobId);

    this.setState({
      jobs: {
        ...this.currentState.jobs,
        [jobId]: updated,
      },
    });
  }

  getJob(jobId: string): BackgroundJob | undefined {
    return this.currentState.jobs[jobId];
  }

  getRunningJobs(): BackgroundJob[] {
    return this.getActiveJobs();
  }

  registerKillHandler(jobId: string, killFn: () => void | Promise<void>): void {
    this.killHandlers.set(jobId, killFn);
  }

  async cancelJob(jobId: string): Promise<void> {
    const killFn = this.killHandlers.get(jobId);
    this.killHandlers.delete(jobId);

    if (killFn) {
      try {
        await Promise.resolve(killFn());
      } catch (error) {
        logger.debug("Failed to cancel background job", { jobId, error });
      }
    }

    const job = this.currentState.jobs[jobId];
    if (!job) {
      return;
    }

    if (job.status === "pending" || job.status === "running") {
      const updated: BackgroundJob = {
        ...job,
        status: "cancelled",
        endTime: new Date(),
      };

      this.setState({
        jobs: {
          ...this.currentState.jobs,
          [jobId]: updated,
        },
      });
    }
  }

  async killAllJobs(): Promise<void> {
    const jobIds = Object.keys(this.currentState.jobs);

    await Promise.all(jobIds.map((id) => this.cancelJob(id)));
  }
}
