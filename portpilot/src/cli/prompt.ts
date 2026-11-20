import readline from "node:readline";

export interface Prompter {
  ask(question: string): Promise<string | null>;
  confirm(question: string): Promise<boolean>;
  close(): void;
}

export interface PromptInput extends NodeJS.ReadableStream {
  isTTY?: boolean;
}

/**
 * Build a prompter over explicit streams (used by tests). Returns null when
 * input is not a terminal, which callers must treat as "cannot ask".
 */
export function createPrompter(
  input: PromptInput,
  output: NodeJS.WritableStream,
): Prompter | null {
  if (!input.isTTY) {
    return null;
  }

  const rl = readline.createInterface({ input, output });

  let closed = false;
  rl.on("close", () => {
    closed = true;
  });

  function ask(question: string): Promise<string | null> {
    if (closed) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      let settled = false;

      const finish = (answer: string | null): void => {
        if (!settled) {
          settled = true;
          rl.removeListener("close", onClose);
          resolve(answer);
        }
      };

      const onClose = (): void => {
        finish(null);
      };

      rl.once("close", onClose);

      try {
        rl.question(question, (answer) => finish(answer));
      } catch {
        // stdin can close between the isTTY check and the prompt.
        finish(null);
      }
    });
  }

  return {
    ask,
    async confirm(question: string): Promise<boolean> {
      const answer = await ask(question);
      return answer !== null && /^(y|yes)$/i.test(answer.trim());
    },
    close(): void {
      closed = true;
      rl.close();
    },
  };
}

/**
 * Returns null when stdin is not a terminal. Callers must treat that as
 * "cannot ask" and never assume a confirmation.
 */
export function createInteractivePrompter(): Prompter | null {
  return createPrompter(process.stdin, process.stdout);
}
