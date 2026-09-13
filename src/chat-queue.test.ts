import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetChatQueueState,
  buildQueueKey,
  enqueueWeComChatTask,
  hasActiveTask,
  type WeComChatTaskAdoptionLifecycle,
} from "./chat-queue.js";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  _resetChatQueueState();
});

describe("WeCom chat queue", () => {
  it("lets core claim a text answer while the ask_user turn is still running", async () => {
    const answerReceived = createDeferred();
    let questionPending = false;
    let askUserStatus: "waiting" | "answered" = "waiting";
    let claimedText: string | undefined;
    let agentTurns = 0;

    const dispatch = async (
      text: string,
      adoption: WeComChatTaskAdoptionLifecycle,
    ): Promise<void> => {
      await adoption.onAdopted();
      if (questionPending) {
        claimedText = text;
        questionPending = false;
        askUserStatus = "answered";
        answerReceived.resolve();
        return;
      }

      agentTurns += 1;
      questionPending = true;
      await answerReceived.promise;
    };

    const question = enqueueWeComChatTask({
      accountId: "work",
      chatId: "alice",
      task: (adoption) => dispatch("Please choose", adoption),
    });

    await vi.waitFor(() => {
      expect(questionPending).toBe(true);
      expect(hasActiveTask(buildQueueKey("work", "alice"))).toBe(false);
    });

    const answer = enqueueWeComChatTask({
      accountId: "work",
      chatId: "alice",
      task: (adoption) => dispatch("Never mind", adoption),
    });

    expect(answer.status).toBe("immediate");
    await answer.promise;
    await question.promise;

    expect(claimedText).toBe("Never mind");
    expect(askUserStatus).toBe("answered");
    expect(agentTurns).toBe(1);
  });

  it("keeps a same-chat inbound queued until core adopts the earlier turn", async () => {
    const firstCompletion = createDeferred();
    const started: string[] = [];
    let adoption: WeComChatTaskAdoptionLifecycle | undefined;
    let firstSettled = false;

    enqueueWeComChatTask({
      accountId: "work",
      chatId: "alice",
      task: async (candidate) => {
        adoption = candidate;
        started.push("ask_user");
        try {
          await firstCompletion.promise;
        } finally {
          firstSettled = true;
        }
      },
    });
    const answer = enqueueWeComChatTask({
      accountId: "work",
      chatId: "alice",
      task: async () => {
        started.push("answer");
      },
    });

    try {
      await vi.waitFor(() => expect(started).toEqual(["ask_user"]));
      expect(answer.status).toBe("queued");
      expect(adoption).toBeDefined();

      await adoption?.onAdopted();

      await vi.waitFor(() => expect(started).toEqual(["ask_user", "answer"]));
      expect(firstSettled).toBe(false);
      await answer.promise;
    } finally {
      firstCompletion.resolve();
    }
  });

  it("keeps ordinary follow-up execution serial after core defers it", async () => {
    const firstCompletion = createDeferred();
    const started: string[] = [];
    let activeRun = true;

    const first = enqueueWeComChatTask({
      accountId: "work",
      chatId: "alice",
      task: async (adoption) => {
        await adoption.onAdopted();
        started.push("first");
        await firstCompletion.promise;
        activeRun = false;
      },
    });

    await vi.waitFor(() => {
      expect(started).toEqual(["first"]);
      expect(hasActiveTask(buildQueueKey("work", "alice"))).toBe(false);
    });

    const second = enqueueWeComChatTask({
      accountId: "work",
      chatId: "alice",
      task: async (adoption) => {
        if (activeRun) {
          adoption.onDeferred();
          await firstCompletion.promise;
        }
        await adoption.onAdopted();
        started.push("second");
      },
    });

    expect(second.status).toBe("immediate");
    expect(started).toEqual(["first"]);

    firstCompletion.resolve();
    await first.promise;
    await second.promise;

    expect(started).toEqual(["first", "second"]);
  });

  it("falls back to settlement when a task fails before core adoption", async () => {
    const started: string[] = [];

    const failed = enqueueWeComChatTask({
      accountId: "work",
      chatId: "alice",
      task: async () => {
        started.push("failed");
        throw new Error("dispatch failed before adoption");
      },
    });
    const next = enqueueWeComChatTask({
      accountId: "work",
      chatId: "alice",
      task: async () => {
        started.push("next");
      },
    });

    await expect(failed.promise).rejects.toThrow("dispatch failed before adoption");
    await next.promise;

    expect(started).toEqual(["failed", "next"]);
  });

  it("keeps different chats independent", async () => {
    const firstCompletion = createDeferred();
    const started: string[] = [];

    enqueueWeComChatTask({
      accountId: "work",
      chatId: "alice",
      task: async () => {
        started.push("alice");
        await firstCompletion.promise;
      },
    });
    const bob = enqueueWeComChatTask({
      accountId: "work",
      chatId: "bob",
      task: async () => {
        started.push("bob");
      },
    });

    try {
      await bob.promise;
      expect(started).toEqual(["alice", "bob"]);
    } finally {
      firstCompletion.resolve();
    }
  });
});
