import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // The simulator currently runs as a static/P2P app. Keep this hook for
  // future API routes without pulling database scaffolding into the server.
  void app;

  return httpServer;
}
