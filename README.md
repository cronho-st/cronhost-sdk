# Cronhost SDK

Official TypeScript SDK for [Cronhost](https://cronho.st) - schedule HTTP requests with cron expressions.

## Installation

```bash
npm install cronhost
```

## Quick Start

```typescript
import { Cronhost } from "cronhost";

const cronhost = new Cronhost({
  apiKey: "ch_your_api_key_here",
});

// Create a new schedule
const schedule = await cronhost.createSchedule({
  name: "Daily Health Check",
  cronExpression: "0 9 * * *", // 9 AM daily
  timezone: "UTC",
  endpoint: "https://api.example.com/health",
  httpMethod: "GET",
});

// Get all schedules
const schedules = await cronhost.getSchedules();

// Get job history for a schedule (paginated)
const page = await cronhost.getJobs({ scheduleId: schedule.id });
console.log(page.jobs, page.total, page.totalPages);
```

## API Reference

### Configuration

```typescript
const cronhost = new Cronhost({
  apiKey: "ch_your_api_key_here",
  // baseUrl defaults to https://cronho.st
});
```

### Schedule Management

- `getSchedules()` - List all schedules
- `getSchedule(id)` - Get a specific schedule
- `createSchedule(data)` - Create a schedule (pass an array to bulk create up to 1000)
- `updateSchedule(id, data)` - Update an existing schedule
- `deleteSchedule(id)` - Delete a schedule
- `triggerSchedule(id)` - Manually trigger a schedule; returns the new job's id (string)
- `toggleSchedule(id, enabled)` - Enable/disable a schedule; returns the updated schedule

### Execution model

- Success is `status < 400` by default. Override per schedule with
  `expectedStatusCodes`, a comma-separated list of 3-digit codes and ranges
  (e.g. `"200-299,410"`). Blank or omitted means the default rule.
- `maxRetries` is the total number of attempts including the first, clamped to
  1-10 (a value of 0 is treated as 1). Retries fire only for `5xx`, `408`,
  `429`, timeouts, and network errors, with exponential backoff. Deterministic
  `4xx` responses are not retried.
- `timeoutSeconds` is clamped to 1-300.
- A monthly execution is a scheduled run or a manual trigger. Retries do not
  count toward your plan's execution quota.

```typescript
await cronhost.createSchedule({
  name: "Sync",
  cronExpression: "*/5 * * * *",
  timezone: "UTC",
  endpoint: "https://api.example.com/sync",
  httpMethod: "POST",
  maxRetries: 5,
  timeoutSeconds: 30,
  expectedStatusCodes: "200-299,202",
});
```

### Job Management

- `getJobs(params)` - List a schedule's jobs. `scheduleId` is required; returns a
  paginated `JobsPage` (`{ jobs, page, pageSize, totalPages, total }`).
- `getJob(id)` - Get a specific job

```typescript
const page = await cronhost.getJobs({
  scheduleId: schedule.id,
  status: "FAILED", // optional
  page: 1, // 1-based, optional
  pageSize: 50, // optional, max 100
});
```

### Notification Channels

Channels are the destinations that receive alerts. Read responses never include
secrets (webhook URLs, bot tokens).

- `listNotificationChannels()` - List your channels
- `createNotificationChannel(data)` - Create a channel (`email`, `slack`, `discord`, `telegram`)
- `getNotificationChannel(id)` - Get one channel
- `updateNotificationChannel(id, data)` - Update a channel's label and/or config
- `deleteNotificationChannel(id)` - Delete a channel
- `verifyNotificationChannel(id)` - Send a test notification and mark verified on success

```typescript
const channel = await cronhost.createNotificationChannel({
  type: "slack",
  label: "Ops alerts",
  config: { webhookUrl: "https://hooks.slack.com/services/..." },
});

await cronhost.verifyNotificationChannel(channel.id);
```

### Schedule Notification Preferences

Choose which outcomes notify you for a schedule and which verified channels
receive them.

- `getScheduleNotifications(scheduleId)` - Read a schedule's preference
- `setScheduleNotifications(scheduleId, data)` - Set the preference

```typescript
await cronhost.setScheduleNotifications(schedule.id, {
  notifyOn: "failure", // "none" | "success" | "failure" | "both"
  channelIds: [channel.id],
});
```

`channelIds` is required when `notifyOn` is not `"none"`, every channel must be
verified, and `success`/`both` require at least one webhook channel (Slack,
Discord, or Telegram). Some outcomes and channel types are gated by plan.

## Migrating from 1.x

- `getJobs()` now requires `params.scheduleId` and returns a paginated
  `JobsPage` instead of `Job[]`. Read the rows from `page.jobs`.
- `GetJobsParams` uses `pageSize` instead of `limit` (the API still accepts
  `limit` as an alias) and `scheduleId` is now required.

## Documentation

For complete API documentation, visit [docs.cronho.st](https://docs.cronho.st)

## License

MIT
