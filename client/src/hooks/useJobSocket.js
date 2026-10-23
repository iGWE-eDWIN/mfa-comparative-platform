import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

export const JOB_EVENTS = [
  'job:started',
  'protocol:started',
  'iteration:progress',
  'protocol:completed',
  'job:completed',
  'job:failed',
  'job:cancelled',
];

/**
 * Subscribe to Socket.IO events for one job (FR7). The socket authenticates with the
 * session cookie; the server only delivers the owner's job events.
 */
export function useJobSocket(jobId, onEvent) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    const socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    const listeners = JOB_EVENTS.map((ev) => {
      const fn = (payload) => payload?.jobId === jobId && handler.current(ev, payload);
      socket.on(ev, fn);
      return [ev, fn];
    });
    socket.on('connect', () => handler.current('socket:connected', {}));
    socket.on('disconnect', () => handler.current('socket:disconnected', {}));
    return () => {
      listeners.forEach(([ev, fn]) => socket.off(ev, fn));
      socket.close();
    };
  }, [jobId]);
}
