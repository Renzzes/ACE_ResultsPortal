/**
 * Enter-to-send and permanent conversation delete.
 * The database probe inserts one thread inside a transaction and rolls it back.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { closePool, initDb, loadRootEnv, messagesRepo, withTransaction } from "@workspace/db";
import {
  deliverConversationDeleted,
  registerLiveClientForTests,
  resetLiveClientsForTests,
} from "../../artifacts/api-server/src/lib/message-live.js";
import { enterSendsMessage, messageBodyToSend } from "../../artifacts/ace-results-portal/src/lib/message-composer.ts";
import { removeConversation } from "../../artifacts/ace-results-portal/src/lib/message-live-state.ts";
import { request, sql } from "../../lib/db/src/pool.ts";

loadRootEnv();

after(async () => {
  await closePool();
});

const root = new URL("../../", import.meta.url);

function readRepo(relativePath: string) {
  return readFileSync(new URL(relativePath, root), "utf8");
}

function sink() {
  const sent: string[] = [];
  return {
    readyState: 1,
    sent,
    send(data: string) {
      sent.push(data);
    },
    close() {
      this.readyState = 3;
    },
    once() {
      return undefined;
    },
  };
}

test("Enter sends and Shift+Enter does not", () => {
  assert.equal(enterSendsMessage({ key: "Enter", shiftKey: false }), true);
  assert.equal(enterSendsMessage({ key: "Enter", shiftKey: true }), false);
  assert.equal(enterSendsMessage({ key: "Enter", shiftKey: false, isComposing: true }), false);
  assert.equal(enterSendsMessage({ key: "a", shiftKey: false }), false);
});

test("empty and whitespace-only drafts are not sent", () => {
  assert.equal(messageBodyToSend("", false), null);
  assert.equal(messageBodyToSend("   ", false), null);
  assert.equal(messageBodyToSend("\n\n", false), null);
  assert.equal(messageBodyToSend("  \n  ", false), null);
});

test("a pending send is not submitted again", () => {
  assert.equal(messageBodyToSend("Hello", true), null);
});

test("trim keeps internal newlines", () => {
  assert.equal(messageBodyToSend("  Hello\nHow are you?  ", false), "Hello\nHow are you?");
});

test("deleted conversation leaves the list", () => {
  const next = removeConversation(
    [
      { id: 1, unreadCount: 0 },
      { id: 2, unreadCount: 3 },
    ],
    2,
  );
  assert.deepEqual(
    next.map((row) => row.id),
    [1],
  );
});

test("conversation.deleted reaches only the captured participants", () => {
  resetLiveClientsForTests();
  const member = sink();
  const otherMember = sink();
  const stranger = sink();
  registerLiveClientForTests({ userId: 11, audience: "staff", socket: member });
  registerLiveClientForTests({ userId: 21, audience: "staff", socket: otherMember });
  registerLiveClientForTests({ userId: 99, audience: "portal", socket: stranger });

  deliverConversationDeleted({ conversationId: 123, recipientUserIds: [11, 21] });

  assert.equal(member.sent.length, 1);
  assert.equal(otherMember.sent.length, 1);
  assert.equal(stranger.sent.length, 0);
  const event = JSON.parse(member.sent[0]!) as { type: string; conversationId: number };
  assert.deepEqual(event, { type: "conversation.deleted", conversationId: 123 });
  assert.equal(JSON.stringify(event).includes("password"), false);
  assert.equal(JSON.stringify(event).includes("token"), false);
  resetLiveClientsForTests();
});

test("close stays a close, and delete is a participant-authorized transaction", () => {
  const staff = readRepo("artifacts/api-server/src/routes/messages.ts");
  const portal = readRepo("artifacts/api-server/src/routes/portal-messages.ts");
  const schema = readRepo("docs/migration/sql/007_create_notifications_messaging.sql");
  assert.match(staff, /router\.post\("\/messages\/threads\/:id\/close"[\s\S]*messagesRepo\.closeThread\(id\)/);
  assert.match(staff, /router\.delete\("\/messages\/threads\/:id"[\s\S]*findParticipant\(id, req\.user!\.userId\)/);
  assert.match(staff, /withTransaction\(async \(tx\) => \{[\s\S]*messagesRepo\.deleteThread\(id, tx\)/);
  assert.match(portal, /router\.post\("\/portal\/messages\/:threadId\/close"[\s\S]*messagesRepo\.closeThread\(threadId\)/);
  assert.match(portal, /router\.delete\("\/portal\/messages\/:threadId"[\s\S]*loadAuthorizedPortalThread\(identity, threadId\)/);
  assert.match(portal, /res\.status\(404\)\.json\(\{ error: "Thread not found" \}\)/);
  assert.match(schema, /FK_message_participants_thread[\s\S]*ON DELETE CASCADE/);
  assert.match(schema, /FK_messages_thread[\s\S]*ON DELETE CASCADE/);
  const threadStart = schema.indexOf("CREATE TABLE dbo.message_threads");
  const threadTable = schema.slice(threadStart, schema.indexOf("message_participants", threadStart));
  assert.match(threadTable, /is_closed/);
  assert.doesNotMatch(threadTable, /is_deleted/);
});

test("deleting one thread cascades and rolls back with the transaction", async () => {
  await initDb();
  const users = await request().query(`SELECT TOP 2 id FROM dbo.users ORDER BY id`);
  const ids = (users.recordset as Array<{ id: number }>).map((row) => row.id);
  assert.ok(ids.length >= 1, "at least one portal user is required");
  const createdById = ids[0]!;
  const otherId = ids[1] ?? ids[0]!;
  let threadId = 0;

  await assert.rejects(
    () =>
      withTransaction(async (tx) => {
        const created = await messagesRepo.createThread(
          {
            subject: "delete-probe",
            createdById,
            participantUserIds: [otherId],
            firstMessageBody: "Hello\nWorld",
          },
          tx,
        );
        threadId = created.thread.id;
        const removed = await messagesRepo.deleteThread(threadId, tx);
        assert.equal(removed, true);
        const counts = await request(tx)
          .input("threadId", sql.Int, threadId)
          .query(`
            SELECT
              (SELECT COUNT(*) FROM dbo.message_threads WHERE id = @threadId) AS threads,
              (SELECT COUNT(*) FROM dbo.message_participants WHERE thread_id = @threadId) AS participants,
              (SELECT COUNT(*) FROM dbo.messages WHERE thread_id = @threadId) AS messages
          `);
        const row = counts.recordset[0] as { threads: number; participants: number; messages: number };
        assert.equal(Number(row.threads), 0);
        assert.equal(Number(row.participants), 0);
        assert.equal(Number(row.messages), 0);
        throw new Error("rollback-probe");
      }),
    /rollback-probe/,
  );

  const after = await request()
    .input("threadId", sql.Int, threadId)
    .query(`SELECT COUNT(*) AS total FROM dbo.message_threads WHERE id = @threadId`);
  assert.equal(Number((after.recordset[0] as { total: number }).total), 0);
});

test("live delete authorization does not trust a thread id", async (t) => {
  const api = `http://127.0.0.1:${process.env.PORT ?? "5000"}`;
  const adminUser = process.env.ADMIN_BOOTSTRAP_USERNAME;
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const doctorUser = process.env.DOCTOR_BOOTSTRAP_USERNAME;
  const doctorPassword = process.env.DOCTOR_BOOTSTRAP_PASSWORD;
  if (!adminUser || !adminPassword || !doctorUser || !doctorPassword) {
    t.skip("bootstrap credentials are not loaded");
    return;
  }

  let refreshStatus = 0;
  try {
    refreshStatus = (await fetch(`${api}/api/auth/refresh`, { method: "POST" })).status;
  } catch {
    t.skip("API is not running");
    return;
  }
  assert.equal(refreshStatus, 404);

  async function login(username: string, password: string, portal: string) {
    const response = await fetch(`${api}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, portal }),
    });
    const body = (await response.json()) as { accessToken?: string; user?: { id?: number } };
    return { status: response.status, token: body.accessToken ?? "", userId: body.user?.id ?? 0 };
  }

  const admin = await login(adminUser, adminPassword, "admin");
  const doctor = await login(doctorUser, doctorPassword, "doctor");
  assert.equal(admin.status, 200);
  assert.equal(doctor.status, 200);
  assert.ok(admin.token && doctor.token);

  const missing = await fetch(`${api}/api/messages/threads/2147483646`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${doctor.token}` },
  });
  assert.equal(missing.status, 404);

  const anonymous = await fetch(`${api}/api/messages/threads/1`, { method: "DELETE" });
  assert.equal(anonymous.status, 401);

  await initDb();
  const inserted = await request()
    .input("subject", sql.NVarChar(255), "delete-probe-live")
    .input("createdById", sql.Int, admin.userId)
    .query(`
      INSERT INTO dbo.message_threads (subject, created_by_id)
      OUTPUT INSERTED.id
      VALUES (@subject, @createdById)
    `);
  const threadId = Number((inserted.recordset[0] as { id: number }).id);
  await request()
    .input("threadId", sql.Int, threadId)
    .input("adminId", sql.Int, admin.userId)
    .input("doctorId", sql.Int, doctor.userId)
    .query(`
      INSERT INTO dbo.message_participants (thread_id, user_id) VALUES (@threadId, @adminId), (@threadId, @doctorId);
      INSERT INTO dbo.messages (thread_id, sender_user_id, body) VALUES (@threadId, @adminId, N'Delete probe');
    `);

  try {
  const staffUser = process.env.STAFF_BOOTSTRAP_USERNAME;
  const staffPassword = process.env.STAFF_BOOTSTRAP_PASSWORD;
  assert.ok(staffUser && staffPassword);
  const staff = await login(staffUser, staffPassword, "staff");
  assert.equal(staff.status, 200);
  const forbidden = await fetch(`${api}/api/messages/threads/${threadId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${staff.token}` },
  });
  assert.equal(forbidden.status, 403);

  const patientIdentifier = process.env.PATIENT_BOOTSTRAP_HIS_ID || process.env.PATIENT_BOOTSTRAP_USERNAME;
  const patientPassword = process.env.PATIENT_BOOTSTRAP_PASSWORD;
  const patientLastName = process.env.PATIENT_BOOTSTRAP_LAST_NAME;
  if (patientIdentifier && patientPassword && patientLastName) {
    const patientLogin = await fetch(`${api}/api/portal/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: patientIdentifier,
        password: patientPassword,
        lastName: patientLastName,
      }),
    });
    if (patientLogin.status === 200) {
      const patientBody = (await patientLogin.json()) as { accessToken?: string };
      const patientDelete = await fetch(`${api}/api/portal/messages/${threadId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${patientBody.accessToken ?? ""}` },
      });
      assert.equal(patientDelete.status, 404);
    } else {
      t.diagnostic(`patient portal login returned ${patientLogin.status}`);
    }
  }

  async function readySocket(token: string) {
    const socket = new WebSocket(api.replace(/^http/, "ws") + "/api/messages/live");
    const events: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("socket timed out")), 5000);
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "auth", token }));
      });
      socket.addEventListener("message", (event) => {
        const text = String(event.data);
        events.push(text);
        if (text.includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("socket failed"));
      });
    });
    return { socket, events };
  }

  const doctorTabA = await readySocket(doctor.token);
  const doctorTabB = await readySocket(doctor.token);
  const staffSocket = await readySocket(staff.token);

  const deleted = await fetch(`${api}/api/messages/threads/${threadId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(deleted.status, 200);

  const deadline = Date.now() + 3000;
  while (
    Date.now() < deadline &&
    (!doctorTabA.events.some((row) => row.includes("conversation.deleted")) ||
      !doctorTabB.events.some((row) => row.includes("conversation.deleted")))
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  for (const tab of [doctorTabA, doctorTabB]) {
    const deletion = tab.events.find((row) => row.includes("conversation.deleted"));
    assert.ok(deletion);
    const parsed = JSON.parse(deletion!) as { type: string; conversationId: number };
    assert.deepEqual(parsed, { type: "conversation.deleted", conversationId: threadId });
    assert.equal(JSON.stringify(parsed).includes("password"), false);
    tab.socket.close();
  }
  assert.equal(
    staffSocket.events.some((row) => row.includes("conversation.deleted")),
    false,
  );
  staffSocket.socket.close();

  const gone = await fetch(`${api}/api/messages/threads/${threadId}`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(gone.status, 404);
  const doctorGone = await fetch(`${api}/api/messages/threads/${threadId}`, {
    headers: { Authorization: `Bearer ${doctor.token}` },
  });
  assert.equal(doctorGone.status, 404);
  } finally {
    await request()
      .input("threadId", sql.Int, threadId)
      .query(`DELETE FROM dbo.message_threads WHERE id = @threadId AND subject = N'delete-probe-live'`);
  }
});
