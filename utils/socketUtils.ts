import { Socket } from "socket.io-client";
import { AckResponse } from "@/types/types";

interface EmitOptions {
  maxRetries?: number;
  timeoutMs?: number;
}

/**
 * Emits a socket event and awaits an acknowledgment from the server.
 * Retries up to `maxRetries` times if timed out or failed.
 */
export async function emitWithAck<T = AckResponse>(
  socket: Socket | null,
  event: string,
  data: any,
  options: EmitOptions = {}
): Promise<T> {
  const { maxRetries = 3, timeoutMs = 3000 } = options;

  if (!socket) {
    throw new Error("Socket is not connected");
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const result = await new Promise<T>((resolve, reject) => {
        let finished = false;
        const timer = setTimeout(() => {
          if (!finished) {
            finished = true;
            reject(new Error(`Timeout waiting for ACK on "${event}"`));
          }
        }, timeoutMs);

        try {
          socket.emit(event, data, (response: T) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve(response);
          });
        } catch (err) {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          reject(err);
        }
      });
      return result;
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) {
        console.warn(`[Socket] Event "${event}" failed after ${maxRetries} attempts:`, err);
        throw err;
      }
      // Linear backoff
      await new Promise((res) => setTimeout(res, attempt * 200));
    }
  }
  throw new Error(`Failed to emit "${event}" after ${maxRetries} retries`);
}

