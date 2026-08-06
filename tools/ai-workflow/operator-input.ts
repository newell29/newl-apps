import { createInterface, Interface } from "node:readline/promises";
import { Readable, Writable } from "node:stream";

export type OperatorReadline = {
  question: (prompt: string) => Promise<string>;
};

export type OperatorInput = {
  readline: OperatorReadline;
  close: () => void;
};

export function createOperatorInput(
  input: Readable = process.stdin,
  output: Writable = process.stdout
): OperatorInput {
  let closed = false;
  let activeReadline: Interface | null = null;

  return {
    readline: {
      question: async (prompt: string) => {
        if (closed) throw new Error("Operator input is closed.");
        if (activeReadline) throw new Error("Another operator prompt is already active.");

        input.resume();
        const currentReadline = createInterface({ input, output });
        activeReadline = currentReadline;
        try {
          return await currentReadline.question(prompt);
        } finally {
          if (activeReadline === currentReadline) activeReadline = null;
          currentReadline.close();
          input.pause();
        }
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      activeReadline?.close();
      activeReadline = null;
      input.pause();
    }
  };
}
