// End-to-end smoke test for the Cronhost SDK against a running app.
//
// Usage (from cronhost-sdk/):
//   CRONHOST_API_KEY=ch_xxx bun run scripts/smoke-test.ts
//
// Env:
//   CRONHOST_API_KEY        (required) an API key from the dashboard
//   CRONHOST_BASE_URL       (default http://localhost:3000)
//   CRONHOST_TEST_ENDPOINT  (default https://httpstat.us/200) target for schedules
//   CRONHOST_TEST_EMAIL     (default smoke-test@example.com) email channel address
//   CRONHOST_VERIFY_CHANNEL  set "true" to also test verify + setScheduleNotifications
//                            (verify sends a REAL notification, so use a real address)
//
// Creates temporary schedules/channels and deletes them at the end.

import {
  Cronhost,
  type BulkCreateResponse,
} from "../index";

const API_KEY = process.env.CRONHOST_API_KEY;
const BASE_URL = process.env.CRONHOST_BASE_URL ?? "http://localhost:3000";
const TEST_ENDPOINT =
  process.env.CRONHOST_TEST_ENDPOINT ?? "https://httpstat.us/200";
const TEST_EMAIL = process.env.CRONHOST_TEST_EMAIL ?? "lakshaybomotra@gmail.com";
const DO_VERIFY = process.env.CRONHOST_VERIFY_CHANNEL === "true";

if (!API_KEY) {
  console.error("Set CRONHOST_API_KEY (an API key from the dashboard).");
  process.exit(1);
}

const client = new Cronhost({ apiKey: API_KEY, baseUrl: BASE_URL });

let passed = 0;
let failed = 0;
const createdSchedules = new Set<string>();
const createdChannels = new Set<string>();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`FAIL  ${name}: ${message}`);
  }
}

async function run(): Promise<void> {
  let scheduleId = "";
  let jobId = "";
  let channelId = "";

  await step("createSchedule clamps maxRetries/timeout + expectedStatusCodes", async () => {
    const s = await client.createSchedule({
      name: "SDK smoke - single",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      endpoint: TEST_ENDPOINT,
      httpMethod: "GET",
      maxRetries: 0, // expect clamp to 1
      timeoutSeconds: 999, // expect clamp to 300
      expectedStatusCodes: "200-299,202",
    });
    assert(typeof s.id === "string" && s.id.length > 0, "no schedule id returned");
    scheduleId = s.id;
    createdSchedules.add(s.id);
    assert(s.maxRetries === 1, `maxRetries clamp expected 1, got ${s.maxRetries}`);
    assert(
      s.timeoutSeconds === 300,
      `timeoutSeconds clamp expected 300, got ${s.timeoutSeconds}`,
    );
    assert(
      s.expectedStatusCodes === "200-299,202",
      `expectedStatusCodes round-trip failed, got ${String(s.expectedStatusCodes)}`,
    );
  });

  await step("getSchedules includes the new schedule", async () => {
    const list = await client.getSchedules();
    assert(Array.isArray(list), "getSchedules did not return an array");
    assert(list.some((s) => s.id === scheduleId), "created schedule not in list");
  });

  await step("getSchedule by id", async () => {
    const s = await client.getSchedule(scheduleId);
    assert(s.id === scheduleId, "getSchedule id mismatch");
  });

  await step("updateSchedule (partial) clears expectedStatusCodes with empty string", async () => {
    // Deliberately omit cronExpression/timezone to exercise partial updates.
    const s = await client.updateSchedule(scheduleId, {
      maxRetries: 5,
      expectedStatusCodes: "",
    });
    assert(s.maxRetries === 5, `maxRetries update expected 5, got ${s.maxRetries}`);
    assert(
      s.expectedStatusCodes === null || s.expectedStatusCodes === undefined,
      `expectedStatusCodes not cleared, got ${String(s.expectedStatusCodes)}`,
    );
  });

  await step("toggleSchedule returns the updated schedule (disable then enable)", async () => {
    const off = await client.toggleSchedule(scheduleId, false);
    assert(off.isEnabled === false, "toggle to disabled failed");
    const on = await client.toggleSchedule(scheduleId, true);
    assert(on.isEnabled === true, "toggle to enabled failed");
  });

  await step("triggerSchedule returns the new job id", async () => {
    const id = await client.triggerSchedule(scheduleId);
    assert(typeof id === "string" && id.length > 0, "no job id returned");
    jobId = id;
    const job = await client.getJob(id);
    assert(job.scheduleId === scheduleId, "job scheduleId mismatch");
  });

  await step("getJobs returns a paginated JobsPage", async () => {
    const page = await client.getJobs({ scheduleId, page: 1, pageSize: 10 });
    assert(Array.isArray(page.jobs), "page.jobs is not an array");
    assert(typeof page.total === "number", "page.total is not a number");
    assert(typeof page.totalPages === "number", "page.totalPages is not a number");
    assert(page.page === 1, `page.page expected 1, got ${page.page}`);
    assert(page.pageSize === 10, `page.pageSize expected 10, got ${page.pageSize}`);
    if (!jobId && page.jobs[0]) jobId = page.jobs[0].id;
  });

  await step("getJobs guards missing scheduleId", async () => {
    try {
      // @ts-expect-error scheduleId is required at the type level; test the runtime guard too
      await client.getJobs({});
      throw new Error("expected getJobs to throw without scheduleId");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert(
        message.includes("scheduleId is required"),
        `unexpected error from guard: ${message}`,
      );
    }
  });

  await step("getJob by id", async () => {
    assert(jobId.length > 0, "no job id available to fetch");
    const job = await client.getJob(jobId);
    assert(job.id === jobId, "getJob id mismatch");
  });

  await step("bulk createSchedule returns count + ids", async () => {
    const res = (await client.createSchedule([
      {
        name: "SDK smoke - bulk 1",
        cronExpression: "0 10 * * *",
        timezone: "UTC",
        endpoint: TEST_ENDPOINT,
        httpMethod: "GET",
      },
      {
        name: "SDK smoke - bulk 2",
        cronExpression: "0 11 * * *",
        timezone: "UTC",
        endpoint: TEST_ENDPOINT,
        httpMethod: "GET",
      },
    ])) as BulkCreateResponse;
    assert(res.count === 2, `bulk count expected 2, got ${res.count}`);
    assert(res.schedules.length === 2, "bulk schedules length mismatch");
    res.schedules.forEach((s) => createdSchedules.add(s.id));
  });

  await step("createNotificationChannel (email) starts unverified, no secrets", async () => {
    const ch = await client.createNotificationChannel({
      type: "email",
      label: "SDK smoke email",
      config: { to: TEST_EMAIL },
    });
    assert(typeof ch.id === "string" && ch.id.length > 0, "no channel id returned");
    channelId = ch.id;
    createdChannels.add(ch.id);
    assert(ch.type === "email", `channel type expected email, got ${ch.type}`);
    assert(ch.verified === false, "new channel should be unverified");
    assert(!("config" in ch), "channel view must not expose config/secrets");
  });

  await step("listNotificationChannels includes the new channel", async () => {
    const list = await client.listNotificationChannels();
    assert(Array.isArray(list), "listNotificationChannels did not return an array");
    assert(list.some((c) => c.id === channelId), "created channel not in list");
  });

  await step("getNotificationChannel by id", async () => {
    const ch = await client.getNotificationChannel(channelId);
    assert(ch.id === channelId, "getNotificationChannel id mismatch");
  });

  await step("updateNotificationChannel relabels", async () => {
    const ch = await client.updateNotificationChannel(channelId, {
      label: "SDK smoke email (renamed)",
    });
    assert(ch.label === "SDK smoke email (renamed)", "channel label not updated");
  });

  await step("getScheduleNotifications defaults to none", async () => {
    const pref = await client.getScheduleNotifications(scheduleId);
    assert(pref.scheduleId === scheduleId, "preference scheduleId mismatch");
    assert(pref.notifyOn === "none", `notifyOn expected none, got ${pref.notifyOn}`);
    assert(Array.isArray(pref.channels), "preference channels is not an array");
  });

  if (DO_VERIFY) {
    await step("verifyNotificationChannel marks verified", async () => {
      const ch = await client.verifyNotificationChannel(channelId);
      assert(ch.verified === true, "channel not verified after verify");
    });

    await step("setScheduleNotifications attaches channel on failure", async () => {
      const pref = await client.setScheduleNotifications(scheduleId, {
        notifyOn: "failure",
        channelIds: [channelId],
      });
      assert(pref.notifyOn === "failure", "notifyOn not set to failure");
      assert(
        pref.channels.some((c) => c.channelId === channelId),
        "channel not attached to preference",
      );
    });
  } else {
    console.log(
      "SKIP  verifyNotificationChannel + setScheduleNotifications (set CRONHOST_VERIFY_CHANNEL=true with a real destination)",
    );
  }
}

async function cleanup(): Promise<void> {
  // Delete schedules first so preferences release channel references, then channels.
  for (const id of createdSchedules) {
    try {
      await client.deleteSchedule(id);
    } catch (err) {
      console.error(`cleanup: failed to delete schedule ${id}:`, err);
    }
  }
  for (const id of createdChannels) {
    try {
      await client.deleteNotificationChannel(id);
    } catch (err) {
      console.error(`cleanup: failed to delete channel ${id}:`, err);
    }
  }
}

async function main(): Promise<void> {
  console.log(`Cronhost SDK smoke test against ${BASE_URL}\n`);
  try {
    await run();
  } catch (err) {
    failed++;
    console.error("Unexpected error:", err);
  } finally {
    await cleanup();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
