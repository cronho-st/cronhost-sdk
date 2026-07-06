export interface CronhostConfig {
  apiKey: string;
  baseUrl?: string;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type JobStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

export interface Schedule {
  id: string;
  name: string;
  description?: string;
  cronExpression: string;
  timezone: string;
  endpoint: string;
  httpMethod: HttpMethod;
  body?: string;
  headers?: string;
  isEnabled: boolean;
  nextRunAtUtc: Date;
  lastRunAtUtc?: Date;
  createdAt: Date;
  updatedAt: Date;
  maxRetries: number;
  timeoutSeconds: number;
  // Comma-separated 3-digit codes/ranges (e.g. "200-299,410"). When null the
  // schedule uses the default success rule (status < 400).
  expectedStatusCodes?: string | null;
}

export interface Job {
  id: string;
  scheduleId: string;
  status: JobStatus;
  scheduledRunAtUtc: Date;
  attemptNumber: number;
  httpMethod: HttpMethod;
  endpoint: string;
  body?: string;
  headers?: string;
  statusCode?: number;
  response?: string;
  startedAtUtc?: Date;
  completedAtUtc?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScheduleData {
  name: string;
  description?: string;
  cronExpression: string;
  timezone: string;
  endpoint: string;
  httpMethod: HttpMethod;
  body?: string;
  headers?: Record<string, string>;
  // Total attempts including the first, clamped to 1-10 (0 becomes 1).
  maxRetries?: number;
  // Per-request timeout, clamped to 1-300 seconds.
  timeoutSeconds?: number;
  // Codes counted as success (e.g. "200-299,410"). Omit or blank for the
  // default rule (status < 400).
  expectedStatusCodes?: string;
}

export interface UpdateScheduleData {
  name?: string;
  description?: string;
  cronExpression?: string;
  timezone?: string;
  endpoint?: string;
  httpMethod?: HttpMethod;
  body?: string;
  headers?: Record<string, string>;
  maxRetries?: number;
  timeoutSeconds?: number;
  // Pass "" to clear back to the default success rule.
  expectedStatusCodes?: string;
}

export interface GetJobsParams {
  // Required: the jobs list is always scoped to a single schedule.
  scheduleId: string;
  status?: JobStatus;
  // 1-based page number.
  page?: number;
  pageSize?: number;
}

export interface JobsPage {
  jobs: Job[];
  page: number;
  pageSize: number;
  totalPages: number;
  total: number;
}

export type NotificationChannelType = "email" | "slack" | "discord" | "telegram";

export type NotifyOn = "none" | "success" | "failure" | "both";

// Non-secret view of a channel. Config secrets (webhook URLs, bot tokens) are
// never returned by the API.
export interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
  verified: boolean;
  label: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailChannelConfig {
  to: string;
}

export interface WebhookChannelConfig {
  webhookUrl: string;
}

export interface TelegramChannelConfig {
  botToken: string;
  chatId?: string;
}

export type CreateNotificationChannelData =
  | { type: "email"; label: string; config: EmailChannelConfig }
  | { type: "slack"; label: string; config: WebhookChannelConfig }
  | { type: "discord"; label: string; config: WebhookChannelConfig }
  | { type: "telegram"; label: string; config: TelegramChannelConfig };

// `type` is immutable; only the label and/or config can change.
export interface UpdateNotificationChannelData {
  label?: string;
  config?: Record<string, unknown>;
}

export interface PreferenceChannelRef {
  channelId: string;
  type: NotificationChannelType;
  label: string;
  verified: boolean;
}

export interface ScheduleNotificationPreference {
  scheduleId: string;
  notifyOn: NotifyOn;
  channels: PreferenceChannelRef[];
  warning?: string | null;
}

export interface SetScheduleNotificationData {
  notifyOn: NotifyOn;
  // Verified channel ids to attach. Required when notifyOn is not "none".
  channelIds?: string[];
}

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

export interface BulkCreateResponse {
  count: number;
  schedules: {
    id: string;
    name: string;
  }[];
}

export interface BulkValidationError {
  index: number;
  schedule: CreateScheduleData;
  error: string;
}

export interface ApiError {
  error: {
    message: string;
    code: string;
    details?: any;
    index?: number;
  };
}

export class Cronhost {
  private config: CronhostConfig;
  private baseUrl: string;

  constructor(config: CronhostConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? "https://cronho.st";
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          ...options.headers,
        },
      });

      // Check content type to determine how to parse the response
      const contentType = response.headers.get("content-type");
      const isJson = contentType?.includes("application/json");

      let data: any;
      let responseText = "";

      try {
        if (isJson) {
          data = await response.json();
        } else {
          responseText = await response.text();
          // Try to parse as JSON anyway in case content-type is wrong
          try {
            data = JSON.parse(responseText);
          } catch {
            data = { error: { message: responseText } };
          }
        }
      } catch (parseError) {
        const err = parseError as Error;
        throw new Error(`Failed to parse response: ${err.message}`);
      }

      if (!response.ok) {
        // Enhanced error message with more context
        const errorMessage =
          data?.error?.message ||
          data?.message ||
          responseText ||
          `HTTP ${response.status}: ${response.statusText}`;

        const errorDetails = {
          status: response.status,
          statusText: response.statusText,
          url: url,
          message: errorMessage,
          ...(data?.error && { error: data.error }),
        };

        throw new Error(`API request failed: ${errorMessage}`, {
          cause: errorDetails,
        });
      }

      return data;
    } catch (error) {
      const err = error as Error;
      // If it's already our custom error, re-throw it
      if (
        err.message?.startsWith("API request failed:") ||
        err.message?.startsWith("Failed to parse response:")
      ) {
        throw err;
      }

      // Handle network errors and other fetch failures
      throw new Error(`Network error: ${err.message}`, { cause: err });
    }
  }

  // Schedule methods
  async getSchedules(): Promise<Schedule[]> {
    const response = await this.request<ApiResponse<Schedule[]>>("/schedules");
    return response.data;
  }

  async getSchedule(id: string): Promise<Schedule> {
    const response = await this.request<ApiResponse<Schedule>>(
      `/schedules/${id}`
    );
    return response.data;
  }

  async createSchedule(data: CreateScheduleData): Promise<Schedule>;
  async createSchedule(data: CreateScheduleData[]): Promise<BulkCreateResponse>;
  async createSchedule(
    data: CreateScheduleData | CreateScheduleData[]
  ): Promise<Schedule | BulkCreateResponse> {
    const isBulk = Array.isArray(data);

    if (isBulk) {
      // Bulk creation
      if (data.length === 0) {
        throw new Error("At least one schedule is required for bulk creation");
      }
      if (data.length > 1000) {
        throw new Error("Cannot create more than 1000 schedules at once");
      }

      const requestData = data.map((schedule) => ({
        ...schedule,
        headers: schedule.headers
          ? JSON.stringify(schedule.headers)
          : undefined,
      }));

      const response = await this.request<ApiResponse<BulkCreateResponse>>(
        "/schedules/bulk",
        {
          method: "POST",
          body: JSON.stringify(requestData),
        }
      );
      return response.data;
    } else {
      // Single schedule creation
      const requestData = {
        ...data,
        headers: data.headers ? JSON.stringify(data.headers) : undefined,
      };

      const response = await this.request<ApiResponse<Schedule>>("/schedules", {
        method: "POST",
        body: JSON.stringify(requestData),
      });
      return response.data;
    }
  }

  async updateSchedule(
    id: string,
    data: UpdateScheduleData
  ): Promise<Schedule> {
    const requestData = {
      ...data,
      headers: data.headers ? JSON.stringify(data.headers) : undefined,
    };

    const response = await this.request<ApiResponse<Schedule>>(
      `/schedules/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(requestData),
      }
    );
    return response.data;
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.request(`/schedules/${id}`, {
      method: "DELETE",
    });
  }

  // Returns the id of the created job. Fetch its details with getJob(id).
  async triggerSchedule(id: string): Promise<string> {
    const response = await this.request<ApiResponse<string>>(
      `/schedules/${id}/trigger`,
      {
        method: "POST",
      }
    );
    return response.data;
  }

  async toggleSchedule(id: string, enabled: boolean): Promise<Schedule> {
    const response = await this.request<ApiResponse<Schedule>>(
      `/schedules/${id}/toggle`,
      {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }
    );
    return response.data;
  }

  // Job methods
  async getJobs(params: GetJobsParams): Promise<JobsPage> {
    if (!params.scheduleId) {
      throw new Error("scheduleId is required to list jobs");
    }

    const searchParams = new URLSearchParams();
    searchParams.set("scheduleId", params.scheduleId);
    if (params.status) searchParams.set("status", params.status);
    if (params.page) searchParams.set("page", params.page.toString());
    if (params.pageSize) searchParams.set("pageSize", params.pageSize.toString());

    const response = await this.request<ApiResponse<JobsPage>>(
      `/jobs?${searchParams.toString()}`
    );
    return response.data;
  }

  async getJob(id: string): Promise<Job> {
    const response = await this.request<ApiResponse<Job>>(`/jobs/${id}`);
    return response.data;
  }

  // Notification channel methods
  async listNotificationChannels(): Promise<NotificationChannel[]> {
    const response = await this.request<ApiResponse<NotificationChannel[]>>(
      "/notification-channels"
    );
    return response.data;
  }

  async createNotificationChannel(
    data: CreateNotificationChannelData
  ): Promise<NotificationChannel> {
    const response = await this.request<ApiResponse<NotificationChannel>>(
      "/notification-channels",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
    return response.data;
  }

  async getNotificationChannel(id: string): Promise<NotificationChannel> {
    const response = await this.request<ApiResponse<NotificationChannel>>(
      `/notification-channels/${id}`
    );
    return response.data;
  }

  async updateNotificationChannel(
    id: string,
    data: UpdateNotificationChannelData
  ): Promise<NotificationChannel> {
    const response = await this.request<ApiResponse<NotificationChannel>>(
      `/notification-channels/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      }
    );
    return response.data;
  }

  async deleteNotificationChannel(id: string): Promise<void> {
    await this.request(`/notification-channels/${id}`, {
      method: "DELETE",
    });
  }

  // Sends a test notification and marks the channel verified on success.
  async verifyNotificationChannel(id: string): Promise<NotificationChannel> {
    const response = await this.request<ApiResponse<NotificationChannel>>(
      `/notification-channels/${id}/verify`,
      {
        method: "POST",
      }
    );
    return response.data;
  }

  // Schedule notification preferences
  async getScheduleNotifications(
    scheduleId: string
  ): Promise<ScheduleNotificationPreference> {
    const response = await this.request<
      ApiResponse<ScheduleNotificationPreference>
    >(`/schedules/${scheduleId}/notifications`);
    return response.data;
  }

  async setScheduleNotifications(
    scheduleId: string,
    data: SetScheduleNotificationData
  ): Promise<ScheduleNotificationPreference> {
    const response = await this.request<
      ApiResponse<ScheduleNotificationPreference>
    >(`/schedules/${scheduleId}/notifications`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return response.data;
  }
}

export default Cronhost;
