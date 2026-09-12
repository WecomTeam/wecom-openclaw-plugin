type QueueStatus = "queued" | "immediate";

export type WeComChatTaskAdoptionLifecycle = {
  admission: "exclusive";
  onAdopted: () => void;
  onDeferred: () => void;
  onAbandoned: () => void;
};

const chatQueues = new Map<string, Promise<void>>();

/**
 * 构建队列键
 *
 * 使用 accountId + chatId 作为维度，确保同一会话中的消息串行处理。
 * 不同会话之间互不影响，可以并行处理。
 */
export function buildQueueKey(accountId: string, chatId: string): string {
  return `${accountId}:${chatId}`;
}

/**
 * 检查指定会话是否有尚未被核心接管的任务
 */
export function hasActiveTask(key: string): boolean {
  return chatQueues.has(key);
}

/**
 * 将任务加入按核心接管边界释放的串行准入队列
 *
 * 如果队列中已有尚未被核心接管的任务（status="queued"），新任务会排队等待；
 * 如果队列为空（status="immediate"），任务立即执行。核心接管后，agent run
 * 可以继续执行，而下一条消息可以进入核心处理 active-run 策略。
 *
 * 即使前一个任务在接管前失败，后续任务仍会继续执行。
 */
export function enqueueWeComChatTask(params: {
  accountId: string;
  chatId: string;
  task: (turnAdoptionLifecycle: WeComChatTaskAdoptionLifecycle) => Promise<void>;
}): { status: QueueStatus; promise: Promise<void> } {
  const { accountId, chatId, task } = params;
  const key = buildQueueKey(accountId, chatId);
  const prev = chatQueues.get(key) ?? Promise.resolve();
  const status: QueueStatus = chatQueues.has(key) ? "queued" : "immediate";
  let resolveTask!: () => void;
  let rejectTask!: (error: unknown) => void;
  const taskCompletion = new Promise<void>((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });
  // The returned promise remains observable without producing an unhandled
  // rejection when fire-and-forget call sites intentionally ignore it.
  void taskCompletion.catch(() => undefined);

  const runUntilAdopted = async (): Promise<void> => {
    let released = false;
    let release!: () => void;
    const adopted = new Promise<void>((resolve) => {
      release = () => {
        if (released) return;
        released = true;
        resolve();
      };
    });
    const turnAdoptionLifecycle: WeComChatTaskAdoptionLifecycle = {
      admission: "exclusive",
      onAdopted: release,
      onDeferred: release,
      onAbandoned: release,
    };

    // Core adopts the inbound turn before the agent run completes. Release this
    // transport lane at that boundary so an ask_user answer or reset command can
    // enter core while the adopted turn is still waiting. Settlement is the
    // fallback for failures that happen before core can adopt the turn.
    void Promise.resolve()
      .then(() => task(turnAdoptionLifecycle))
      .then(
        () => {
          resolveTask();
          release();
        },
        (error) => {
          rejectTask(error);
          release();
        },
      );
    await adopted;
  };

  // Continue the admission queue even if the previous task failed.
  const next = prev.then(runUntilAdopted, runUntilAdopted);
  chatQueues.set(key, next);

  const cleanup = (): void => {
    // 只有当前任务仍是队列末尾时才清理，避免误删后续任务
    if (chatQueues.get(key) === next) {
      chatQueues.delete(key);
    }
  };

  next.then(cleanup, cleanup);

  return { status, promise: taskCompletion };
}

/** @internal 测试专用：重置所有队列状态 */
export function _resetChatQueueState(): void {
  chatQueues.clear();
}
