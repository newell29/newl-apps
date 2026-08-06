import { createInterface, Interface } from "node:readline/promises";
import { Readable, Writable } from "node:stream";

export type OperatorInput = {
  readline: Interface;
  close: () => void;
};

export function createOperatorInput(
  input: Readable = process.stdin,
  output: Writable = process.stdout
): OperatorInput {
  const readline = createInterface({ input, output });
  input.resume();
  let closed = false;
  return {
    readline,
    close: () => {
      if (closed) return;
      closed = true;
      readline.close();
      input.pause();
    }
  };
}
